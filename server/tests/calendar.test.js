import test from 'node:test';
import assert from 'node:assert';

// Set environment to test
process.env.NODE_ENV = 'test';

import { getUpcomingCalendarEvents, parseICalEvents } from '../src/googleCalendar.js';
import { dbHelpers } from '../src/db.js';

test('Google Calendar Integration Tests', async (t) => {
  await t.test('getUpcomingCalendarEvents returns events in test/offline mode', async () => {
    const events = await getUpcomingCalendarEvents();
    assert.ok(Array.isArray(events), 'Should return an array of events');
    assert.ok(events.length > 0, 'Should return mock upcoming events');
    assert.ok(events[0].summary, 'Event must have a summary');
  });

  await t.test('parseICalEvents parses valid iCal VEVENT string', () => {
    const sampleICal = `
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
SUMMARY:Weekly Standup Meeting
DESCRIPTION:Discussing sprint deliverables and blockages.
LOCATION:Google Meet
DTSTART:20260720T090000Z
END:VEVENT
END:VCALENDAR
    `;

    const parsed = parseICalEvents(sampleICal);
    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0].summary, 'Weekly Standup Meeting');
    assert.strictEqual(parsed[0].meeting_type, 'online');
  });
});
