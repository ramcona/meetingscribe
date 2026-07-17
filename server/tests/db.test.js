import test from 'node:test';
import assert from 'node:assert';

// Set environment to test
process.env.NODE_ENV = 'test';

// Import helpers
import { dbHelpers } from '../src/db.js';

test('Database helpers test', async (t) => {
  await t.test('create and get meeting', () => {
    const meetingId = dbHelpers.createMeeting({
      title: 'Weekly Standup',
      description: 'Reviewing weekly tasks',
      client: 'Internal',
      meeting_type: 'online'
    });

    assert.ok(meetingId, 'Should return a valid meeting ID');

    const meeting = dbHelpers.getMeeting(meetingId);
    assert.strictEqual(meeting.title, 'Weekly Standup');
    assert.strictEqual(meeting.description, 'Reviewing weekly tasks');
    assert.strictEqual(meeting.client, 'Internal');
    assert.strictEqual(meeting.meeting_type, 'online');
    assert.strictEqual(meeting.status, 'draft');
  });

  await t.test('update meeting fields', () => {
    const meetingId = dbHelpers.createMeeting({
      title: 'Demo Day',
      meeting_type: 'offline'
    });

    const updated = dbHelpers.updateMeeting(meetingId, {
      status: 'recording',
      duration_seconds: 120,
      audio_path: '/path/to/audio.webm'
    });
    assert.strictEqual(updated, true);

    const meeting = dbHelpers.getMeeting(meetingId);
    assert.strictEqual(meeting.status, 'recording');
    assert.strictEqual(meeting.duration_seconds, 120);
    assert.strictEqual(meeting.audio_path, '/path/to/audio.webm');
  });

  await t.test('transcript segments and speaker name update', () => {
    const meetingId = dbHelpers.createMeeting({ title: 'Diarization Test' });

    dbHelpers.addTranscriptSegments([
      {
        meeting_id: meetingId,
        speaker_label: 'Orang 1',
        text: 'Halo Budi.',
        start_time: 0.0,
        end_time: 1.5,
        segment_order: 1
      },
      {
        meeting_id: meetingId,
        speaker_label: 'Orang 2',
        text: 'Halo Ani, apa kabar?',
        start_time: 1.5,
        end_time: 3.5,
        segment_order: 2
      }
    ]);

    const segments = dbHelpers.getTranscriptSegments(meetingId);
    assert.strictEqual(segments.length, 2);
    assert.strictEqual(segments[0].speaker_label, 'Orang 1');
    assert.strictEqual(segments[1].text, 'Halo Ani, apa kabar?');

    // Update speaker name
    const renamed = dbHelpers.updateSpeakerName(meetingId, 'Orang 1', 'Ani');
    assert.strictEqual(renamed, true);

    const updatedMeeting = dbHelpers.getMeeting(meetingId);
    assert.strictEqual(updatedMeeting.segments[0].speaker_name, 'Ani');
    // The other segment should still have null speaker_name
    assert.strictEqual(updatedMeeting.segments[1].speaker_name, null);
  });

  await t.test('add and get summaries', () => {
    const meetingId = dbHelpers.createMeeting({ title: 'MoM Test' });
    
    const summaryId = dbHelpers.addSummary(meetingId, 'mom', '# MoM Content');
    assert.ok(summaryId);

    const summaries = dbHelpers.getSummaries(meetingId);
    assert.strictEqual(summaries.length, 1);
    assert.strictEqual(summaries[0].type, 'mom');
    assert.strictEqual(summaries[0].content, '# MoM Content');
  });

  await t.test('settings helpers', () => {
    const success = dbHelpers.setSetting('gemini_api_key', 'test_key');
    assert.strictEqual(success, true);

    const val = dbHelpers.getSetting('gemini_api_key');
    assert.strictEqual(val, 'test_key');

    // Update setting
    dbHelpers.setSetting('gemini_api_key', 'new_test_key');
    assert.strictEqual(dbHelpers.getSetting('gemini_api_key'), 'new_test_key');
  });

  await t.test('delete meeting cascades', () => {
    const meetingId = dbHelpers.createMeeting({ title: 'Delete Cascade Test' });
    dbHelpers.addTranscriptSegments([
      {
        meeting_id: meetingId,
        speaker_label: 'Orang 1',
        text: 'Deleted soon.',
        start_time: 0.0,
        end_time: 1.0,
        segment_order: 1
      }
    ]);
    dbHelpers.addSummary(meetingId, 'recap', 'Deleted recap');

    // Verify they exist
    assert.strictEqual(dbHelpers.getTranscriptSegments(meetingId).length, 1);
    assert.strictEqual(dbHelpers.getSummaries(meetingId).length, 1);

    // Delete meeting
    const deleted = dbHelpers.deleteMeeting(meetingId);
    assert.strictEqual(deleted, true);

    // Verify cascade deleted
    assert.strictEqual(dbHelpers.getMeeting(meetingId), null);
    assert.strictEqual(dbHelpers.getTranscriptSegments(meetingId).length, 0);
    assert.strictEqual(dbHelpers.getSummaries(meetingId).length, 0);
  });
});
