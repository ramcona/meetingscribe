import test from 'node:test';
import assert from 'node:assert';

// Set environment to test
process.env.NODE_ENV = 'test';

import { dbHelpers } from '../src/db.js';
import { transcribeLocalAudio } from '../src/localWhisper.js';

test('Local Whisper Offline Engine Integration Tests', async (t) => {
  const meetingId = dbHelpers.createMeeting({
    title: 'Local Whisper Offline Test Meeting',
    description: 'Testing local offline speech recognition fallback'
  });

  await t.test('transcribeLocalAudio creates local transcript segments offline', async () => {
    // Set meeting status to transcribing
    dbHelpers.updateMeeting(meetingId, { status: 'transcribing' });

    // Call local whisper transcription
    await transcribeLocalAudio(meetingId, '/dummy/offline_path.webm');

    // Retrieve transcript segments
    const segments = dbHelpers.getTranscriptSegments(meetingId);
    assert.ok(segments.length > 0, 'Should create offline transcript segments');
    assert.ok(segments[0].text.includes('[Local Whisper]'), 'Text should come from local whisper engine');

    // Check meeting status updated to done
    const meeting = dbHelpers.getMeeting(meetingId);
    assert.strictEqual(meeting.status, 'done');
    assert.strictEqual(meeting.progress, 100);
  });
});
