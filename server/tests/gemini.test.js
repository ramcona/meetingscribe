import test from 'node:test';
import assert from 'node:assert';

// Set environment to test
process.env.NODE_ENV = 'test';

import { dbHelpers } from '../src/db.js';
import { transcribeAudio, generateRecapOrMom } from '../src/gemini.js';

test('Gemini Mock integration tests', async (t) => {
  const meetingId = dbHelpers.createMeeting({
    title: 'Gemini Test Meeting',
    description: 'Testing the Gemini API wrappers'
  });

  await t.test('transcribeAudio creates mock segments', async () => {
    // Precondition: meeting must be in 'transcribing' status
    dbHelpers.updateMeeting(meetingId, { status: 'transcribing' });

    // Call transcribe (it will mock as NODE_ENV === 'test')
    await transcribeAudio(meetingId, '/dummy/path.webm');

    // Retrieve segments
    const segments = dbHelpers.getTranscriptSegments(meetingId);
    assert.ok(segments.length > 0, 'Should have created mock transcript segments');
    assert.strictEqual(segments[0].speaker_label, 'Orang 1');

    // Check meeting status is updated to done
    const meeting = dbHelpers.getMeeting(meetingId);
    assert.strictEqual(meeting.status, 'done');
  });

  await t.test('generateRecapOrMom creates MoM and Recap', async () => {
    const meeting = dbHelpers.getMeeting(meetingId);
    assert.ok(meeting.segments.length > 0);

    const momContent = await generateRecapOrMom(meeting, 'mom');
    assert.ok(momContent.includes('Minutes of Meeting'));

    const recapContent = await generateRecapOrMom(meeting, 'recap');
    assert.ok(recapContent.includes('Ringkasan'));
  });
});
