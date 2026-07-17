import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '../data');

// Ensure the data directory exists
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = process.env.NODE_ENV === 'test' ? ':memory:' : path.join(dataDir, 'meetingscribe.db');
const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize database schema
export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      client TEXT,
      meeting_type TEXT,                -- 'online' | 'offline'
      status TEXT DEFAULT 'draft',      -- draft | recording | transcribing | done | failed
      audio_path TEXT,                  -- path file rekaman
      duration_seconds INTEGER,
      recording_started_at TEXT,        -- timestamp perekaman dimulai
      progress INTEGER DEFAULT 0,       -- persentase analisis (0-100)
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

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT                        -- simpan Gemini API key, dll
    );
  `);

  // Run dynamic schema migrations for existing databases
  try {
    db.prepare('ALTER TABLE meetings ADD COLUMN recording_started_at TEXT').run();
  } catch (err) {
    // Column already exists, ignore
  }
  try {
    db.prepare('ALTER TABLE meetings ADD COLUMN progress INTEGER DEFAULT 0').run();
  } catch (err) {
    // Column already exists, ignore
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
    return id;
  },

  getMeeting(id) {
    const meeting = db.prepare('SELECT * FROM meetings WHERE id = ?').get(id);
    if (!meeting) return null;

    const segments = db.prepare('SELECT * FROM transcript_segments WHERE meeting_id = ? ORDER BY segment_order ASC').all(id);
    const summaries = db.prepare('SELECT * FROM summaries WHERE meeting_id = ? ORDER BY created_at DESC').all(id);

    return {
      ...meeting,
      segments,
      summaries
    };
  },

  listMeetings() {
    return db.prepare('SELECT * FROM meetings ORDER BY created_at DESC').all();
  },

  updateMeeting(id, updates) {
    const fields = [];
    const values = [];
    for (const [key, val] of Object.entries(updates)) {
      if (['title', 'description', 'client', 'meeting_type', 'status', 'audio_path', 'duration_seconds', 'recording_started_at', 'progress'].includes(key)) {
        fields.push(`${key} = ?`);
        values.push(val);
      }
    }
    if (fields.length === 0) return false;

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const stmt = db.prepare(`UPDATE meetings SET ${fields.join(', ')} WHERE id = ?`);
    const result = stmt.run(...values);
    return result.changes > 0;
  },

  deleteMeeting(id) {
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
  },

  updateSpeakerName(meetingId, speakerLabel, speakerName) {
    const stmt = db.prepare(`
      UPDATE transcript_segments
      SET speaker_name = ?
      WHERE meeting_id = ? AND speaker_label = ?
    `);
    const result = stmt.run(speakerName, meetingId, speakerLabel);
    return result.changes > 0;
  },

  getTranscriptSegments(meetingId) {
    return db.prepare('SELECT * FROM transcript_segments WHERE meeting_id = ? ORDER BY segment_order ASC').all(meetingId);
  },

  // Summary helpers
  addSummary(meetingId, type, content) {
    const id = crypto.randomUUID();
    const stmt = db.prepare(`
      INSERT INTO summaries (id, meeting_id, type, content)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(id, meetingId, type, content);
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
  }
};

export default db;
