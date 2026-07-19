import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dbHelpers } from './db.js';
import { transcribeAudio, generateRecapOrMom } from './gemini.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const recordingsDir = path.join(__dirname, '../data/recordings');

// Ensure recordings folder exists
if (!fs.existsSync(recordingsDir)) {
  fs.mkdirSync(recordingsDir, { recursive: true });
}

// Multer disk storage setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, recordingsDir);
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
  const durationSeconds = req.body.duration_seconds ? parseInt(req.body.duration_seconds, 10) : 0;

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

// 11. Get settings
router.get('/settings', (req, res) => {
  try {
    const apiKey = dbHelpers.getSetting('gemini_api_key');
    res.json({
      gemini_api_key_set: !!apiKey,
      app_name: process.env.APP_NAME || 'MeetingScribe'
    });
  } catch (error) {
    console.error('Error getting settings:', error);
    res.status(500).json({ error: 'Failed to retrieve settings' });
  }
});

// 12. Save settings
router.post('/settings', (req, res) => {
  const { gemini_api_key } = req.body;
  if (gemini_api_key === undefined) {
    return res.status(400).json({ error: 'gemini_api_key is required' });
  }
  try {
    dbHelpers.setSetting('gemini_api_key', gemini_api_key);
    res.json({ message: 'Settings saved successfully' });
  } catch (error) {
    console.error('Error saving settings:', error);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// 13. Re-trigger transcription/analysis for a failed meeting
router.post('/meetings/:id/reanalyze', async (req, res) => {
  const meetingId = req.params.id;
  try {
    const meeting = dbHelpers.getMeeting(meetingId);
    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }
    if (!meeting.audio_path || !fs.existsSync(meeting.audio_path)) {
      return res.status(400).json({ error: 'No audio file available for reanalysis' });
    }

    // Set status back to transcribing
    dbHelpers.updateMeeting(meetingId, { status: 'transcribing' });

    // Re-trigger background transcription
    transcribeAudio(meetingId, meeting.audio_path).catch((err) => {
      console.error(`Re-analysis transcription job failed for meeting ${meetingId}:`, err);
      dbHelpers.updateMeeting(meetingId, { status: 'failed' });
    });

    res.json({ message: 'Reanalysis started successfully', status: 'transcribing' });
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

export default router;
