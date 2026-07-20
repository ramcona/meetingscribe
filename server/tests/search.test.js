import test from 'node:test';
import assert from 'node:assert';

// Set environment to test
process.env.NODE_ENV = 'test';

import { dbHelpers } from '../src/db.js';

test('Global Full-Text Search Integration Tests', async (t) => {
  const meetingId = dbHelpers.createMeeting({
    title: 'Kubernetes Infrastructure Architecture',
    description: 'Discussing cluster migration to GCP',
    client: 'Fintech Inc'
  });

  dbHelpers.addTranscriptSegments([
    {
      meeting_id: meetingId,
      speaker_label: 'Orang 1',
      speaker_name: 'Lead Architect',
      text: 'We are planning to upgrade our PostgreSQL database cluster next Tuesday.',
      start_time: 12.5,
      end_time: 18.0,
      segment_order: 1
    }
  ]);

  dbHelpers.addSummary(meetingId, 'recap', 'Key decision: PostgreSQL database migration approved.');

  await t.test('searchMeetings matches transcript content', () => {
    const results = dbHelpers.searchMeetings('PostgreSQL');
    assert.ok(results.length > 0, 'Should find meeting matching transcript phrase');
    assert.strictEqual(results[0].id, meetingId);
    assert.ok(results[0].matching_snippets.length > 0);
    assert.ok(results[0].matching_snippets[0].text.includes('PostgreSQL'));
  });

  await t.test('searchMeetings matches client name', () => {
    const results = dbHelpers.searchMeetings('Fintech');
    assert.ok(results.length > 0, 'Should find meeting matching client');
    assert.strictEqual(results[0].id, meetingId);
  });
});
