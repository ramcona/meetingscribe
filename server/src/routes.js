import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dbHelpers } from './db.js';
import { transcribeAudio, generateRecapOrMom, generateChapters } from './gemini.js';
import { getAudioDuration } from './audioUtils.js';
import { getUpcomingCalendarEvents, parseICalEvents } from './googleCalendar.js';
import { transcribeChunkLocalWhisper } from './localWhisper.js';
import { isWhisperCppAvailable, findWhisperCppBinary, getWhisperSetupStatus, runWhisperCppSetup } from './whisperCpp.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const recordingsDir = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, 'recordings')
  : path.join(__dirname, '../data/recordings');

// Ensure recordings folder exists
if (!fs.existsSync(recordingsDir)) {
  fs.mkdirSync(recordingsDir, { recursive: true });
}

// Multer disk storage setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const targetDir = process.env.DATA_DIR
      ? path.join(process.env.DATA_DIR, 'recordings')
      : path.join(__dirname, '../data/recordings');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    cb(null, targetDir);
  },
  filename: (req, file, cb) => {
    // Save file as [meetingId]-[timestamp].[ext]
    const meetingId = req.params.id;
    const ext = path.extname(file.originalname) || '.webm';
    cb(null, `${meetingId}${ext}`);
  }
});

const upload = multer({ storage });

// 1. Create meeting (draft)
router.post('/meetings', (req, res) => {
  const { title, description, client, meeting_type } = req.body;
  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }
  try {
    const id = dbHelpers.createMeeting({ title, description, client, meeting_type });
    res.status(201).json({ id, message: 'Meeting draft created' });
  } catch (error) {
    console.error('Error creating meeting:', error);
    res.status(500).json({ error: 'Failed to create meeting' });
  }
});

// 2. List meetings
router.get('/meetings', (req, res) => {
  try {
    const meetings = dbHelpers.listMeetings();
    res.json(meetings);
  } catch (error) {
    console.error('Error listing meetings:', error);
    res.status(500).json({ error: 'Failed to retrieve meetings' });
  }
});

// 2b. Global Full-Text Search across meetings, transcripts, and summaries
router.get('/search', (req, res) => {
  const query = req.query.q || '';
  try {
    const results = dbHelpers.searchMeetings(query);
    res.json(results);
  } catch (error) {
    console.error('Error performing search:', error);
    res.status(500).json({ error: 'Failed to perform search' });
  }
});

// 3. Detail meeting + transcript + summaries
router.get('/meetings/:id', (req, res) => {
  try {
    const meeting = dbHelpers.getMeeting(req.params.id);
    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }
    res.json(meeting);
  } catch (error) {
    console.error('Error getting meeting:', error);
    res.status(500).json({ error: 'Failed to retrieve meeting details' });
  }
});

// 4. Update meeting (title/desc/client/status)
router.patch('/meetings/:id', (req, res) => {
  try {
    const success = dbHelpers.updateMeeting(req.params.id, req.body);
    if (!success) {
      return res.status(404).json({ error: 'Meeting not found or no changes made' });
    }
    res.json({ message: 'Meeting updated successfully' });
  } catch (error) {
    console.error('Error updating meeting:', error);
    res.status(500).json({ error: 'Failed to update meeting' });
  }
});

// 4b. Save live transcript draft segments separately
router.post('/meetings/:id/live-transcript', (req, res) => {
  const meetingId = req.params.id;
  const { segments } = req.body;
  if (!segments || !Array.isArray(segments)) {
    return res.status(400).json({ error: 'Segments array is required' });
  }
  try {
    dbHelpers.addLiveTranscriptSegments(meetingId, segments);
    res.json({ message: 'Live transcript segments saved successfully' });
  } catch (error) {
    console.error('Error saving live transcript segments:', error);
    res.status(500).json({ error: 'Failed to save live transcript segments' });
  }
});

// 4c. Real-time local Whisper: status, on-demand setup (SSE), and chunk transcription
const memoryUpload = multer({ storage: multer.memoryStorage() });

// GET /api/whisper-engine-status – binary + model readiness
router.get('/whisper-engine-status', (req, res) => {
  const status = getWhisperSetupStatus();
  res.json(status);
});

// POST /api/whisper-setup – on-demand clone+compile+download, streams progress via SSE
router.get('/whisper-setup', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (stage, pct, message) => {
    const payload = JSON.stringify({ stage, pct, message });
    res.write(`data: ${payload}\n\n`);
  };

  try {
    await runWhisperCppSetup(send);
    res.write(`data: ${JSON.stringify({ stage: 'done', pct: 100, message: 'whisper.cpp siap!' })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ stage: 'error', pct: 0, message: err.message })}\n\n`);
  } finally {
    res.end();
  }
});

// POST /api/live-whisper-chunk – live real-time transcription
router.post('/live-whisper-chunk', memoryUpload.single('audio_chunk'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'No audio chunk provided' });
    }
    const text = await transcribeChunkLocalWhisper(req.file.buffer);
    res.json({ text: text || '' });
  } catch (error) {
    console.error('Error processing live whisper chunk:', error);
    res.status(500).json({ error: 'Failed to transcribe chunk' });
  }
});

// 5. Delete meeting
router.delete('/meetings/:id', (req, res) => {
  try {
    // Also delete local audio file if exists
    const meeting = dbHelpers.getMeeting(req.params.id);
    if (meeting && meeting.audio_path) {
      try {
        if (fs.existsSync(meeting.audio_path)) {
          fs.unlinkSync(meeting.audio_path);
        }
      } catch (err) {
        console.error('Error deleting audio file:', err);
      }
    }
    const success = dbHelpers.deleteMeeting(req.params.id);
    if (!success) {
      return res.status(404).json({ error: 'Meeting not found' });
    }
    res.json({ message: 'Meeting deleted successfully' });
  } catch (error) {
    console.error('Error deleting meeting:', error);
    res.status(500).json({ error: 'Failed to delete meeting' });
  }
});

// 6. Upload recording & trigger transcription
router.post('/meetings/:id/recording', upload.single('audio'), async (req, res) => {
  const meetingId = req.params.id;
  let durationSeconds = req.body.duration_seconds ? parseInt(req.body.duration_seconds, 10) : 0;

  if (!req.file) {
    return res.status(400).json({ error: 'No audio file uploaded' });
  }

  try {
    const meeting = dbHelpers.getMeeting(meetingId);
    if (!meeting) {
      // Cleanup uploaded file if meeting doesn't exist
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Meeting not found' });
    }

    const finalPath = req.file.path;

    // Detect exact duration from audio file if durationSeconds was not provided or 0
    if (!durationSeconds || durationSeconds <= 0) {
      const detectedDur = await getAudioDuration(finalPath);
      if (detectedDur > 0) {
        durationSeconds = Math.round(detectedDur);
      }
    }

    const recordingStartedAt = req.body.recording_started_at || new Date(Date.now() - durationSeconds * 1000).toISOString();

    // Update meeting with audio path, started_at timestamp, progress, and transcribing status
    dbHelpers.updateMeeting(meetingId, {
      audio_path: finalPath,
      duration_seconds: durationSeconds,
      recording_started_at: recordingStartedAt,
      progress: 10,
      status: 'transcribing'
    });

    // Run transcription in the background (async)
    transcribeAudio(meetingId, finalPath).catch((err) => {
      console.error(`Transcription job failed for meeting ${meetingId}:`, err);
      dbHelpers.updateMeeting(meetingId, { status: 'failed', progress: 0 });
    });

    res.json({
      message: 'Audio uploaded successfully. Transcription started in background.',
      audio_path: finalPath,
      recording_started_at: recordingStartedAt,
      status: 'transcribing'
    });
  } catch (error) {
    console.error('Error uploading recording:', error);
    res.status(500).json({ error: 'Failed to upload recording' });
  }
});

// 7. Get transcript segments
router.get('/meetings/:id/transcript', (req, res) => {
  try {
    const segments = dbHelpers.getTranscriptSegments(req.params.id);
    res.json(segments);
  } catch (error) {
    console.error('Error getting transcript:', error);
    res.status(500).json({ error: 'Failed to retrieve transcript' });
  }
});

// 8. Bulk rename speaker label to name
router.patch('/meetings/:id/speaker', (req, res) => {
  const { speaker_label, speaker_name } = req.body;
  if (!speaker_label) {
    return res.status(400).json({ error: 'speaker_label is required' });
  }
  try {
    const success = dbHelpers.updateSpeakerName(req.params.id, speaker_label, speaker_name || null);
    res.json({ message: 'Speaker updated successfully', success });
  } catch (error) {
    console.error('Error updating speaker:', error);
    res.status(500).json({ error: 'Failed to update speaker name' });
  }
});

// 9. Generate MoM/Recap
router.post('/meetings/:id/summary', async (req, res) => {
  const { type, language } = req.body; // 'mom' | 'recap', language: 'id' | 'en' | 'bilingual'
  if (!type || !['mom', 'recap'].includes(type)) {
    return res.status(400).json({ error: 'Type must be "mom" or "recap"' });
  }

  try {
    const meeting = dbHelpers.getMeeting(req.params.id);
    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    if (!meeting.segments || meeting.segments.length === 0) {
      return res.status(400).json({ error: 'Cannot generate summary without a transcript' });
    }

    // Call Gemini API to generate MoM/Recap
    const content = await generateRecapOrMom(meeting, type, language || 'id');
    const summaryId = dbHelpers.addSummary(req.params.id, type, content);

    res.json({
      id: summaryId,
      type,
      content,
      message: 'Summary generated successfully'
    });
  } catch (error) {
    console.error('Error generating summary:', error);
    res.status(500).json({ error: error.message || 'Failed to generate summary' });
  }
});

// 10. Get existing summaries
router.get('/meetings/:id/summary', (req, res) => {
  try {
    const summaries = dbHelpers.getSummaries(req.params.id);
    res.json(summaries);
  } catch (error) {
    console.error('Error getting summaries:', error);
    res.status(500).json({ error: 'Failed to retrieve summaries' });
  }
});

// 10b. Generate AI Topic Chapters
router.post('/meetings/:id/chapters', async (req, res) => {
  try {
    const meeting = dbHelpers.getMeeting(req.params.id);
    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }
    if (!meeting.segments || meeting.segments.length === 0) {
      return res.status(400).json({ error: 'Cannot generate chapters without a transcript' });
    }

    const chapters = await generateChapters(meeting);
    res.json({ chapters, message: 'Chapters generated successfully' });
  } catch (error) {
    console.error('Error generating chapters:', error);
    res.status(500).json({ error: error.message || 'Failed to generate chapters' });
  }
});

// 10c. Get existing chapters
router.get('/meetings/:id/chapters', (req, res) => {
  try {
    const chapters = dbHelpers.getChapters(req.params.id);
    res.json(chapters);
  } catch (error) {
    console.error('Error getting chapters:', error);
    res.status(500).json({ error: 'Failed to retrieve chapters' });
  }
});

// 10d. Fetch Google Calendar Upcoming Events
router.get('/calendar/events', async (req, res) => {
  try {
    const events = await getUpcomingCalendarEvents();
    res.json(events);
  } catch (error) {
    console.error('Error fetching calendar events:', error);
    res.status(500).json({ error: 'Failed to fetch calendar events' });
  }
});

// 10e. Import Google Calendar Event to create Meeting Draft
router.post('/calendar/import', (req, res) => {
  const { summary, description, client, meeting_type } = req.body;
  if (!summary) {
    return res.status(400).json({ error: 'Event summary / title is required' });
  }

  try {
    const meetingId = dbHelpers.createMeeting({
      title: summary,
      description: description || '',
      client: client || '',
      meeting_type: meeting_type || 'offline'
    });

    const meeting = dbHelpers.getMeeting(meetingId);
    res.json(meeting);
  } catch (error) {
    console.error('Error importing calendar event:', error);
    res.status(500).json({ error: 'Failed to import calendar event' });
  }
});

// 10f. Upload and parse .ics calendar file
router.post('/calendar/upload-ics', express.text({ limit: '10mb' }), (req, res) => {
  try {
    const icalContent = req.body;
    if (!icalContent) {
      return res.status(400).json({ error: 'No .ics content provided' });
    }
    const events = parseICalEvents(icalContent);
    const result = dbHelpers.upsertGoogleCalendarEvents(events);
    res.json({ events, created: result.created, updated: result.updated });
  } catch (error) {
    console.error('Error parsing uploaded .ics:', error);
    res.status(500).json({ error: 'Failed to parse .ics file' });
  }
});

// 10g. Perform live background sync with Google Calendar
router.post('/calendar/sync', async (req, res) => {
  try {
    const events = await getUpcomingCalendarEvents();
    const result = dbHelpers.upsertGoogleCalendarEvents(events);
    res.json({
      message: 'Google Calendar synced successfully',
      created: result.created,
      updated: result.updated,
      total_events: events.length
    });
  } catch (error) {
    console.error('Error syncing Google Calendar:', error);
    res.status(500).json({ error: 'Failed to sync Google Calendar' });
  }
});

// 11. Get settings
router.get('/settings', (req, res) => {
  try {
    const apiKey = dbHelpers.getSetting('gemini_api_key');
    const engine = dbHelpers.getSetting('transcription_engine') || 'auto';
    const icalUrl = dbHelpers.getSetting('google_calendar_ical_url') || '';
    const googleApiKey = dbHelpers.getSetting('google_api_key') || '';
    res.json({
      gemini_api_key_set: !!apiKey,
      transcription_engine: engine,
      google_calendar_ical_url: icalUrl,
      google_api_key_set: !!googleApiKey,
      app_name: process.env.APP_NAME || 'MeetingScribe'
    });
  } catch (error) {
    console.error('Error getting settings:', error);
    res.status(500).json({ error: 'Failed to retrieve settings' });
  }
});

// 12. Save settings
router.post('/settings', (req, res) => {
  const { gemini_api_key, transcription_engine, google_calendar_ical_url, google_api_key } = req.body;
  try {
    if (gemini_api_key !== undefined) {
      dbHelpers.setSetting('gemini_api_key', gemini_api_key);
    }
    if (transcription_engine !== undefined) {
      dbHelpers.setSetting('transcription_engine', transcription_engine);
    }
    if (google_calendar_ical_url !== undefined) {
      dbHelpers.setSetting('google_calendar_ical_url', google_calendar_ical_url);
    }
    if (google_api_key !== undefined) {
      dbHelpers.setSetting('google_api_key', google_api_key);
    }
    res.json({ message: 'Settings saved successfully' });
  } catch (error) {
    console.error('Error saving settings:', error);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// 13. Re-trigger transcription/analysis for a meeting with optional engine choice
router.post('/meetings/:id/reanalyze', async (req, res) => {
  const meetingId = req.params.id;
  const selectedEngine = req.body?.engine; // 'gemini' | 'local_whisper' | 'auto'

  try {
    const meeting = dbHelpers.getMeeting(meetingId);
    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }
    if (!meeting.audio_path || !fs.existsSync(meeting.audio_path)) {
      return res.status(400).json({ error: 'No audio file available for reanalysis' });
    }

    // Clear old transcript segments, chapters, and summaries before fresh re-transcription
    dbHelpers.clearMeetingTranscript(meetingId);

    // Set status back to transcribing with reset progress
    dbHelpers.updateMeeting(meetingId, { status: 'transcribing', progress: 0 });

    // Re-trigger background transcription using selected engine
    transcribeAudio(meetingId, meeting.audio_path, { engine: selectedEngine }).catch((err) => {
      console.error(`Re-analysis transcription job failed for meeting ${meetingId}:`, err);
      dbHelpers.updateMeeting(meetingId, { status: 'failed' });
    });

    res.json({ message: 'Reanalysis started successfully', status: 'transcribing', engine: selectedEngine });
  } catch (error) {
    console.error('Error starting reanalysis:', error);
    res.status(500).json({ error: 'Failed to start reanalysis' });
  }
});

// 14. Cancel transcription / set meeting status to cancelled while preserving audio
router.post('/meetings/:id/cancel', (req, res) => {
  const meetingId = req.params.id;
  try {
    const meeting = dbHelpers.getMeeting(meetingId);
    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    // Reset meeting status to cancelled while preserving audio_path and duration_seconds
    dbHelpers.updateMeeting(meetingId, {
      status: 'cancelled',
      progress: 0
    });

    res.json({ message: 'Transcription cancelled successfully', status: 'cancelled' });
  } catch (error) {
    console.error('Error cancelling transcription:', error);
    res.status(500).json({ error: 'Failed to cancel transcription' });
  }
});

// Helper to calculate directory size in bytes
function getFolderSizeBytes(dirPath) {
  if (!fs.existsSync(dirPath)) return 0;
  let totalSize = 0;
  try {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stats = fs.statSync(filePath);
      if (stats.isFile()) {
        totalSize += stats.size;
      } else if (stats.isDirectory()) {
        totalSize += getFolderSizeBytes(filePath);
      }
    }
  } catch (e) {
    // Ignore unreadable
  }
  return totalSize;
}

// 15. Get storage usage stats
router.get('/storage', (req, res) => {
  try {
    const dataDir = process.env.DATA_DIR || path.join(__dirname, '../data');
    const recDir = path.join(dataDir, 'recordings');
    
    // Sum main db file + WAL journal files
    let dbSizeBytes = 0;
    const dbFiles = ['meetingscribe.db', 'meetingscribe.db-wal', 'meetingscribe.db-shm'];
    for (const f of dbFiles) {
      const p = path.join(dataDir, f);
      if (fs.existsSync(p)) {
        try {
          dbSizeBytes += fs.statSync(p).size;
        } catch (e) {}
      }
    }

    const recordingsSizeBytes = getFolderSizeBytes(recDir);
    let recordingsCount = 0;
    if (fs.existsSync(recDir)) {
      try {
        recordingsCount = fs.readdirSync(recDir).filter(f => !f.startsWith('.')).length;
      } catch (e) {}
    }

    let totalMeetings = 0;
    let totalDurationSeconds = 0;
    try {
      const meetings = dbHelpers.listMeetings();
      totalMeetings = meetings.length;
      totalDurationSeconds = meetings.reduce((acc, m) => acc + (m.duration_seconds || 0), 0);
    } catch (e) {}

    res.json({
      db_size_bytes: dbSizeBytes,
      recordings_size_bytes: recordingsSizeBytes,
      total_storage_bytes: dbSizeBytes + recordingsSizeBytes,
      recordings_count: recordingsCount,
      meetings_count: totalMeetings,
      total_duration_seconds: totalDurationSeconds
    });
  } catch (error) {
    console.error('Error getting storage stats:', error);
    res.json({
      db_size_bytes: 0,
      recordings_size_bytes: 0,
      total_storage_bytes: 0,
      recordings_count: 0,
      meetings_count: 0,
      total_duration_seconds: 0
    });
  }
});

// 16. Cleanup orphaned recordings
router.post('/storage/cleanup', (req, res) => {
  try {
    let deletedCount = 0;
    let reclaimedBytes = 0;
    const dataDir = process.env.DATA_DIR || path.join(__dirname, '../data');
    const recDir = path.join(dataDir, 'recordings');

    if (fs.existsSync(recDir)) {
      const meetings = dbHelpers.listMeetings();
      const validAudioPaths = new Set(meetings.map(m => m.audio_path).filter(Boolean));
      const files = fs.readdirSync(recDir);

      for (const file of files) {
        if (file.startsWith('.')) continue;
        const filePath = path.join(recDir, file);
        if (!validAudioPaths.has(filePath)) {
          try {
            const stats = fs.statSync(filePath);
            reclaimedBytes += stats.size;
            fs.unlinkSync(filePath);
            deletedCount++;
          } catch (e) {
            console.error('Error deleting orphan file:', e);
          }
        }
      }
    }

    res.json({
      message: `Cleaned up ${deletedCount} orphaned recording files`,
      deleted_files_count: deletedCount,
      reclaimed_bytes: reclaimedBytes
    });
  } catch (error) {
    console.error('Error running storage cleanup:', error);
    res.status(500).json({ error: 'Failed to run storage cleanup' });
  }
});

// 17. System Activity Logs API
import logger from './logger.js';

router.get('/logs', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 200;
    const logs = logger.getLogs(limit);
    res.json(logs);
  } catch (error) {
    console.error('Error fetching activity logs:', error);
    res.status(500).json({ error: 'Failed to fetch activity logs' });
  }
});

router.delete('/logs', (req, res) => {
  try {
    logger.clearLogs();
    res.json({ message: 'Activity logs cleared' });
  } catch (error) {
    console.error('Error clearing activity logs:', error);
    res.status(500).json({ error: 'Failed to clear activity logs' });
  }
});

router.post('/logs', (req, res) => {
  try {
    const { level, source, message, details } = req.body;
    const entry = logger.info(source || 'Client', message, details);
    res.status(201).json(entry);
  } catch (error) {
    res.status(500).json({ error: 'Failed to record log' });
  }
});

export default router;

