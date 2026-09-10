import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(__dirname, '../data');

// Ensure the data directory exists
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = process.env.NODE_ENV === 'test' ? ':memory:' : path.join(dataDir, 'meetingscribe.db');
const db = new Database(dbPath);

// Enable foreign keys & WAL mode
db.pragma('foreign_keys = ON');
if (process.env.NODE_ENV !== 'test') {
  try {
    db.pragma('journal_mode = WAL');
  } catch (err) {
    // Ignore if WAL fails
  }
}

// Initialize database schema with versioned migrations
export function initDb() {
  // Create base tables (idempotent)
  db.exec(`
    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      client TEXT,
      meeting_type TEXT,                -- 'online' | 'offline'
      status TEXT DEFAULT 'draft',      -- draft | recording | transcribing | done | failed | cancelled
      audio_path TEXT,                  -- path file rekaman
      duration_seconds INTEGER,
      recording_started_at TEXT,        -- timestamp perekaman dimulai
      progress INTEGER DEFAULT 0,       -- persentase analisis (0-100)
      notes TEXT,                       -- catatan meeting yang diinput user
      google_event_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transcript_segments (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL,
      speaker_label TEXT NOT NULL,      -- "Orang 1", "Orang 2", dst
      speaker_name TEXT,                -- nama asli hasil edit user
      text TEXT NOT NULL,
      start_time REAL,                  -- detik
      end_time REAL,
      segment_order INTEGER,
      FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS summaries (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL,
      type TEXT NOT NULL,               -- 'recap' | 'mom'
      content TEXT NOT NULL,            -- markdown
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      start_time REAL NOT NULL,
      end_time REAL NOT NULL,
      chapter_order INTEGER,
      FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT                        -- simpan Gemini API key, dll
    );

    CREATE TABLE IF NOT EXISTS live_transcript_segments (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL,
      speaker_label TEXT DEFAULT 'Live Speaker',
      text TEXT NOT NULL,
      start_time REAL,
      end_time REAL,
      segment_order INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
    );

    -- Schema migrations tracking table
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT DEFAULT CURRENT_TIMESTAMP,
      description TEXT
    );
  `);

  // Run versioned migrations in order
  runMigrations();

  // Remove leftover dummy test events outside of test mode
  if (process.env.NODE_ENV !== 'test') {
    try {
      db.prepare("DELETE FROM meetings WHERE google_event_id LIKE 'gcal_event_%'").run();
    } catch (err) {
      // Ignore
    }
  }
}

/**
 * Versioned migration runner — each migration has a unique integer version.
 * Migrations are applied once and recorded in schema_migrations table.
 * Safe to add new migrations at any time; old ones are skipped if already applied.
 */
function runMigrations() {
  const getApplied = db.prepare('SELECT version FROM schema_migrations');
  const appliedVersions = new Set(getApplied.all().map(r => r.version));

  const recordMigration = db.prepare(
    'INSERT OR IGNORE INTO schema_migrations (version, description) VALUES (?, ?)'
  );

  const migrations = [
    {
      version: 1,
      description: 'Add recording_started_at column to meetings',
      up: () => {
        try { db.prepare('ALTER TABLE meetings ADD COLUMN recording_started_at TEXT').run(); } catch (e) {}
      }
    },
    {
      version: 2,
      description: 'Add progress column to meetings',
      up: () => {
        try { db.prepare('ALTER TABLE meetings ADD COLUMN progress INTEGER DEFAULT 0').run(); } catch (e) {}
      }
    },
    {
      version: 3,
      description: 'Add notes column to meetings',
      up: () => {
        try { db.prepare('ALTER TABLE meetings ADD COLUMN notes TEXT').run(); } catch (e) {}
      }
    },
    {
      version: 4,
      description: 'Add google_event_id column to meetings',
      up: () => {
        try { db.prepare('ALTER TABLE meetings ADD COLUMN google_event_id TEXT').run(); } catch (e) {}
      }
    },
    {
      version: 5,
      description: 'Create FTS5 full-text search virtual table and sync triggers',
      up: () => {
        db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS meetings_fts USING fts5(
            meeting_id UNINDEXED,
            title,
            client,
            description,
            notes,
            transcript_text,
            speaker_names,
            summary_text
          );
        `);

        // Populate FTS index with existing data
        const existingMeetings = db.prepare('SELECT id FROM meetings').all();
        const populateFts = db.prepare(`
          INSERT INTO meetings_fts(meeting_id, title, client, description, notes, transcript_text, speaker_names, summary_text)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const transaction = db.transaction((meetings) => {
          for (const m of meetings) {
            const full = db.prepare('SELECT * FROM meetings WHERE id = ?').get(m.id);
            const segs = db.prepare('SELECT text, speaker_name FROM transcript_segments WHERE meeting_id = ?').all(m.id);
            const sums = db.prepare('SELECT content FROM summaries WHERE meeting_id = ?').all(m.id);
            const transcriptText = segs.map(s => s.text).join(' ');
            const speakerNames = [...new Set(segs.map(s => s.speaker_name).filter(Boolean))].join(' ');
            const summaryText = sums.map(s => s.content).join(' ');
            try {
              populateFts.run(m.id, full?.title || '', full?.client || '', full?.description || '', full?.notes || '', transcriptText, speakerNames, summaryText);
            } catch (e) {}
          }
        });
        transaction(existingMeetings);
      }
    }
  ];

  for (const migration of migrations) {
    if (!appliedVersions.has(migration.version)) {
      console.log(`[DB Migration] Applying migration v${migration.version}: ${migration.description}`);
      try {
        migration.up();
        recordMigration.run(migration.version, migration.description);
        console.log(`[DB Migration] v${migration.version} applied successfully.`);
      } catch (err) {
        console.error(`[DB Migration] Failed to apply v${migration.version}:`, err);
      }
    }
  }
}

// Ensure the DB is initialized when this module is imported
initDb();

// DB Helper functions
export const dbHelpers = {
  // Meetings helpers
  createMeeting({ title, description, client, meeting_type }) {
    const id = crypto.randomUUID();
    const stmt = db.prepare(`
      INSERT INTO meetings (id, title, description, client, meeting_type, status)
      VALUES (?, ?, ?, ?, ?, 'draft')
    `);
    stmt.run(id, title, description || null, client || null, meeting_type || 'offline');
    dbHelpers.updateFtsIndex(id);
    return id;
  },

  getMeeting(id) {
    const meeting = db.prepare('SELECT * FROM meetings WHERE id = ?').get(id);
    if (!meeting) return null;

    const segments = db.prepare('SELECT * FROM transcript_segments WHERE meeting_id = ? ORDER BY segment_order ASC').all(id);
    const liveSegments = db.prepare('SELECT * FROM live_transcript_segments WHERE meeting_id = ? ORDER BY segment_order ASC').all(id);
    const summaries = db.prepare('SELECT * FROM summaries WHERE meeting_id = ? ORDER BY created_at DESC').all(id);
    const chapters = db.prepare('SELECT * FROM chapters WHERE meeting_id = ? ORDER BY chapter_order ASC').all(id);

    return {
      ...meeting,
      segments,
      live_segments: liveSegments,
      summaries,
      chapters
    };
  },

  listMeetings() {
    return db.prepare('SELECT * FROM meetings ORDER BY created_at DESC').all();
  },

  updateMeeting(id, updates) {
    const fields = [];
    const values = [];
    for (const [key, val] of Object.entries(updates)) {
      if (['title', 'description', 'client', 'meeting_type', 'status', 'audio_path', 'duration_seconds', 'recording_started_at', 'progress', 'notes'].includes(key)) {
        fields.push(`${key} = ?`);
        values.push(val);
      }
    }
    if (fields.length === 0) return false;

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const stmt = db.prepare(`UPDATE meetings SET ${fields.join(', ')} WHERE id = ?`);
    const result = stmt.run(...values);
    if (result.changes > 0) {
      dbHelpers.updateFtsIndex(id);
    }
    return result.changes > 0;
  },

  deleteMeeting(id) {
    dbHelpers.removeFtsIndex(id);
    const stmt = db.prepare('DELETE FROM meetings WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  },

  // Transcript helpers
  addTranscriptSegments(segments) {
    const insert = db.prepare(`
      INSERT INTO transcript_segments (id, meeting_id, speaker_label, speaker_name, text, start_time, end_time, segment_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = db.transaction((segs) => {
      for (const seg of segs) {
        const id = crypto.randomUUID();
        insert.run(
          id,
          seg.meeting_id,
          seg.speaker_label,
          seg.speaker_name || null,
          seg.text,
          seg.start_time,
          seg.end_time,
          seg.segment_order
        );
      }
    });

    transaction(segments);
    if (segments.length > 0) {
      dbHelpers.updateFtsIndex(segments[0].meeting_id);
    }
  },

  updateSpeakerName(meetingId, speakerLabel, speakerName) {
    const stmt = db.prepare(`
      UPDATE transcript_segments
      SET speaker_name = ?
      WHERE meeting_id = ? AND speaker_label = ?
    `);
    const result = stmt.run(speakerName, meetingId, speakerLabel);
    if (result.changes > 0) {
      dbHelpers.updateFtsIndex(meetingId);
    }
    return result.changes > 0;
  },

  getTranscriptSegments(meetingId) {
    return db.prepare('SELECT * FROM transcript_segments WHERE meeting_id = ? ORDER BY segment_order ASC').all(meetingId);
  },

  clearMeetingTranscript(meetingId) {
    db.prepare('DELETE FROM transcript_segments WHERE meeting_id = ?').run(meetingId);
    db.prepare('DELETE FROM chapters WHERE meeting_id = ?').run(meetingId);
    db.prepare('DELETE FROM summaries WHERE meeting_id = ?').run(meetingId);
    dbHelpers.updateFtsIndex(meetingId);
  },

  // Live Transcript helpers
  addLiveTranscriptSegments(meetingId, segments) {
    if (!segments || segments.length === 0) return;
    const insert = db.prepare(`
      INSERT INTO live_transcript_segments (id, meeting_id, speaker_label, text, start_time, end_time, segment_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = db.transaction((segs) => {
      for (let idx = 0; idx < segs.length; idx++) {
        const seg = segs[idx];
        const id = crypto.randomUUID();
        insert.run(
          id,
          meetingId,
          seg.speaker_label || 'Live Speaker',
          seg.text,
          parseFloat(seg.start_time || seg.timestamp) || 0,
          parseFloat(seg.end_time || seg.timestamp) || 0,
          idx + 1
        );
      }
    });

    transaction(segments);
  },

  getLiveTranscriptSegments(meetingId) {
    return db.prepare('SELECT * FROM live_transcript_segments WHERE meeting_id = ? ORDER BY segment_order ASC').all(meetingId);
  },

  // Summary helpers
  addSummary(meetingId, type, content) {
    const id = crypto.randomUUID();
    const stmt = db.prepare(`
      INSERT INTO summaries (id, meeting_id, type, content)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(id, meetingId, type, content);
    dbHelpers.updateFtsIndex(meetingId);
    return id;
  },

  getSummaries(meetingId) {
    return db.prepare('SELECT * FROM summaries WHERE meeting_id = ? ORDER BY created_at DESC').all(meetingId);
  },

  // Settings helpers
  setSetting(key, value) {
    const stmt = db.prepare(`
      INSERT INTO settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    const result = stmt.run(key, value);
    return result.changes > 0;
  },

  getSetting(key) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
  },

  // Full-Text Search helper — uses FTS5 virtual table with seamless LIKE fallback
  searchMeetings(query) {
    if (!query || !query.trim()) return [];
    const q = query.trim();

    // Try FTS5 first (fast indexed search)
    let meetingIds = [];
    try {
      const cleanWords = q.replace(/[^\w\s\-]/g, ' ').trim().split(/\s+/).filter(Boolean);
      if (cleanWords.length > 0) {
        const ftsQuery = cleanWords.map(w => `"${w}"*`).join(' AND ');
        const ftsResults = db.prepare(`
          SELECT meeting_id FROM meetings_fts
          WHERE meetings_fts MATCH ?
          ORDER BY rank
          LIMIT 100
        `).all(ftsQuery);
        meetingIds = ftsResults.map(r => r.meeting_id);
      }
    } catch (ftsErr) {
      console.warn('[DB Search] FTS5 query failed, falling back to LIKE:', ftsErr.message);
    }

    // If FTS5 found nothing or failed, use LIKE query fallback
    if (meetingIds.length === 0) {
      const searchTerm = `%${q}%`;
      const fallback = db.prepare(`
        SELECT DISTINCT m.id FROM meetings m
        LEFT JOIN transcript_segments ts ON m.id = ts.meeting_id
        LEFT JOIN summaries s ON m.id = s.meeting_id
        WHERE m.title LIKE ? OR m.description LIKE ? OR m.client LIKE ? OR m.notes LIKE ?
           OR ts.text LIKE ? OR ts.speaker_name LIKE ?
           OR s.content LIKE ?
        ORDER BY m.created_at DESC
        LIMIT 100
      `).all(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
      meetingIds = fallback.map(r => r.id);
    }

    if (meetingIds.length === 0) return [];

    const searchTerm = `%${q}%`;
    const placeholders = meetingIds.map(() => '?').join(',');
    const meetings = db.prepare(`
      SELECT * FROM meetings WHERE id IN (${placeholders}) ORDER BY created_at DESC
    `).all(...meetingIds);

    return meetings.map(meeting => {
      const snippets = db.prepare(`
        SELECT id, speaker_label, speaker_name, text, start_time, end_time
        FROM transcript_segments
        WHERE meeting_id = ? AND text LIKE ?
        ORDER BY segment_order ASC
        LIMIT 3
      `).all(meeting.id, searchTerm);

      return {
        ...meeting,
        matching_snippets: snippets
      };
    });
  },

  // Chapter helpers
  addChapters(meetingId, chapters) {
    db.prepare('DELETE FROM chapters WHERE meeting_id = ?').run(meetingId);
    const insert = db.prepare(`
      INSERT INTO chapters (id, meeting_id, title, summary, start_time, end_time, chapter_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = db.transaction((chaps) => {
      for (let idx = 0; idx < chaps.length; idx++) {
        const c = chaps[idx];
        const id = crypto.randomUUID();
        insert.run(
          id,
          meetingId,
          c.title,
          c.summary || null,
          parseFloat(c.start_time) || 0,
          parseFloat(c.end_time) || 0,
          c.chapter_order || idx + 1
        );
      }
    });

    transaction(chapters);
  },

  getChapters(meetingId) {
    return db.prepare('SELECT * FROM chapters WHERE meeting_id = ? ORDER BY chapter_order ASC').all(meetingId);
  },

  // Auto-sync Google Calendar events helper
  upsertGoogleCalendarEvents(events) {
    if (!events || events.length === 0) return { created: 0, updated: 0 };

    let created = 0;
    let updated = 0;

    const findStmt = db.prepare('SELECT id, status FROM meetings WHERE google_event_id = ?');
    const insertStmt = db.prepare(`
      INSERT INTO meetings (id, google_event_id, title, description, client, meeting_type, status)
      VALUES (?, ?, ?, ?, ?, ?, 'draft')
    `);
    const updateStmt = db.prepare(`
      UPDATE meetings
      SET title = ?, description = ?, client = ?, meeting_type = ?, updated_at = CURRENT_TIMESTAMP
      WHERE google_event_id = ?
    `);

    const transaction = db.transaction((evtList) => {
      for (const evt of evtList) {
        if (!evt.id || !evt.summary) continue;
        const existing = findStmt.get(evt.id);

        const title = evt.summary;
        const description = evt.description || '';
        const client = evt.client || (evt.attendees && evt.attendees.length ? (evt.attendees[0].displayName || evt.attendees[0].email) : '');
        const meetingType = evt.meeting_type || 'offline';

        if (existing) {
          updateStmt.run(title, description, client, meetingType, evt.id);
          updated++;
        } else {
          const newId = crypto.randomUUID();
          insertStmt.run(newId, evt.id, title, description, client, meetingType);
          created++;
        }
      }
    });

    transaction(events);
    return { created, updated };
  },

  // FTS5 index update — call whenever a meeting's searchable content changes
  updateFtsIndex(meetingId) {
    try {
      // Delete old FTS entry
      db.prepare('DELETE FROM meetings_fts WHERE meeting_id = ?').run(meetingId);

      const meeting = db.prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId);
      if (!meeting) return;

      const segs = db.prepare('SELECT text, speaker_name FROM transcript_segments WHERE meeting_id = ?').all(meetingId);
      const sums = db.prepare('SELECT content FROM summaries WHERE meeting_id = ?').all(meetingId);

      const transcriptText = segs.map(s => s.text).join(' ');
      const speakerNames = [...new Set(segs.map(s => s.speaker_name).filter(Boolean))].join(' ');
      const summaryText = sums.map(s => s.content).join(' ');

      db.prepare(`
        INSERT INTO meetings_fts(meeting_id, title, client, description, notes, transcript_text, speaker_names, summary_text)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        meetingId,
        meeting.title || '',
        meeting.client || '',
        meeting.description || '',
        meeting.notes || '',
        transcriptText,
        speakerNames,
        summaryText
      );
    } catch (err) {
      console.warn('[DB FTS] Failed to update FTS index for meeting', meetingId, ':', err.message);
    }
  },

  // Remove meeting from FTS index
  removeFtsIndex(meetingId) {
    try {
      db.prepare('DELETE FROM meetings_fts WHERE meeting_id = ?').run(meetingId);
    } catch (err) {
      // Ignore
    }
  },
};

export default db;
