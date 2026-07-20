import { dbHelpers } from './db.js';

// Parse basic iCal VEVENT blocks into event objects
export function parseICalEvents(icalData) {
  const events = [];
  const veventRegex = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/g;
  let match;

  while ((match = veventRegex.exec(icalData)) !== null) {
    const block = match[1];
    
    const getField = (name) => {
      const regex = new RegExp(`^${name}(?:;[^:]+)?:(.*)$`, 'm');
      const res = regex.exec(block);
      return res ? res[1].trim() : '';
    };

    const summary = getField('SUMMARY') || 'Untitled Calendar Event';
    const description = getField('DESCRIPTION') || '';
    const location = getField('LOCATION') || '';
    const dtstart = getField('DTSTART');

    let startTime = new Date();
    if (dtstart) {
      const year = dtstart.substring(0, 4);
      const month = dtstart.substring(4, 6);
      const day = dtstart.substring(6, 8);
      startTime = new Date(`${year}-${month}-${day}`);
    }

    events.push({
      id: `ical_${Math.random().toString(36).substring(2, 9)}`,
      summary,
      description: description.replace(/\\n/g, '\n').replace(/\\,/g, ','),
      location,
      meeting_type: (location && location.toLowerCase().includes('meet')) ? 'online' : 'offline',
      start: { dateTime: startTime.toISOString() }
    });
  }

  return events;
}

// Fetch upcoming Google Calendar events
export async function getUpcomingCalendarEvents() {
  const isTest = process.env.NODE_ENV === 'test';
  const calendarUrl = dbHelpers.getSetting('google_calendar_ical_url');
  const googleApiKey = dbHelpers.getSetting('google_api_key');
  const calendarId = dbHelpers.getSetting('google_calendar_id') || 'primary';

  if (isTest || (!calendarUrl && !googleApiKey)) {
    console.log('[Google Calendar] Mock/Offline mode active. Returning upcoming calendar events.');
    const now = new Date();
    return [
      {
        id: 'gcal_event_101',
        summary: 'Sprint Sync & Product Demo',
        description: 'Weekly team sync to discuss sprint progress and feature demos.',
        client: 'Product Team',
        location: 'Google Meet',
        meeting_type: 'online',
        start: { dateTime: new Date(now.getTime() + 15 * 60000).toISOString() },
        attendees: [{ displayName: 'Alice PM' }, { displayName: 'Bob Tech Lead' }]
      },
      {
        id: 'gcal_event_102',
        summary: 'Client Kickoff - Fintech Infra',
        description: 'Architectural discussion for cloud infrastructure migration.',
        client: 'Fintech Inc',
        location: 'Ruang Rapat Utama 3A',
        meeting_type: 'offline',
        start: { dateTime: new Date(now.getTime() + 2 * 3600000).toISOString() },
        attendees: [{ displayName: 'Charlie Client' }]
      }
    ];
  }

  // 1. Fetch via Google Calendar Secret iCal Feed URL
  if (calendarUrl) {
    try {
      const res = await fetch(calendarUrl);
      if (res.ok) {
        const text = await res.text();
        return parseICalEvents(text);
      }
    } catch (err) {
      console.error('[Google Calendar] Error fetching iCal URL:', err);
    }
  }

  // 2. Fetch via Google Calendar v3 API Key
  if (googleApiKey) {
    try {
      const timeMin = new Date().toISOString();
      const apiUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${encodeURIComponent(timeMin)}&singleEvents=true&orderBy=startTime&key=${googleApiKey}`;
      const res = await fetch(apiUrl);
      if (res.ok) {
        const data = await res.json();
        return (data.items || []).map(item => ({
          id: item.id,
          summary: item.summary || 'Untitled Event',
          description: item.description || '',
          location: item.location || '',
          client: item.organizer ? (item.organizer.displayName || item.organizer.email) : '',
          meeting_type: (item.location && item.location.toLowerCase().includes('meet')) ? 'online' : 'offline',
          start: item.start,
          attendees: item.attendees || []
        }));
      }
    } catch (err) {
      console.error('[Google Calendar] Error fetching API Key events:', err);
    }
  }

  return [];
}
