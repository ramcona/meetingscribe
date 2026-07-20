import test from 'node:test';
import assert from 'node:assert';

// Set environment to test
process.env.NODE_ENV = 'test';

import { dbHelpers } from '../src/db.js';
import { generateChapters } from '../src/gemini.js';

test('AI Topic Chapters Integration Tests', async (t) => {
  const meetingId = dbHelpers.createMeeting({
    title: 'Q3 Product Roadmap Review',
    description: 'Sprint planning and feature breakdown'
  });

  dbHelpers.addTranscriptSegments([
    {
      meeting_id: meetingId,
      speaker_label: 'Orang 1',
      speaker_name: 'Product Manager',
      text: 'Selamat pagi rekan-rekan, mari kita buka meeting perencanaan Q3 hari ini.',
      start_time: 0,
      end_time: 15.0,
      segment_order: 1
    },
    {
      meeting_id: meetingId,
      speaker_label: 'Orang 2',
      speaker_name: 'Lead Engineer',
      text: 'Untuk backend architecture, kita akan menggunakan Microservices di Google Cloud.',
      start_time: 15.5,
      end_time: 120.0,
      segment_order: 2
    }
  ]);

  await t.test('generateChapters creates topic chapters and saves to DB', async () => {
    const meeting = dbHelpers.getMeeting(meetingId);
    const chapters = await generateChapters(meeting);

    assert.ok(chapters.length > 0, 'Should generate topic chapters');
    assert.ok(chapters[0].title, 'Chapter must have a title');

    const dbChaps = dbHelpers.getChapters(meetingId);
    assert.strictEqual(dbChaps.length, chapters.length);

    const updatedMeeting = dbHelpers.getMeeting(meetingId);
    assert.ok(updatedMeeting.chapters.length > 0);
  });
});
