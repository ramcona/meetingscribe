import test from 'node:test';
import assert from 'node:assert';

// Set environment to test
process.env.NODE_ENV = 'test';

// Import server
import { app, server } from '../src/index.js';

test('Express API Endpoints integration tests', async (t) => {
  const PORT = server.address().port;
  const baseUrl = `http://localhost:${PORT}/api`;
  let testMeetingId = null;

  await t.test('POST /api/meetings - create meeting draft', async () => {
    const res = await fetch(`${baseUrl}/meetings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'API Test Meeting',
        description: 'Testing the Express API routes',
        client: 'Internal QA',
        meeting_type: 'online'
      })
    });

    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.ok(data.id);
    assert.strictEqual(data.message, 'Meeting draft created');
    testMeetingId = data.id;
  });

  await t.test('GET /api/meetings - list meetings', async () => {
    const res = await fetch(`${baseUrl}/meetings`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data));
    const meeting = data.find(m => m.id === testMeetingId);
    assert.ok(meeting);
    assert.strictEqual(meeting.title, 'API Test Meeting');
  });

  await t.test('GET /api/meetings/:id - get meeting detail', async () => {
    const res = await fetch(`${baseUrl}/meetings/${testMeetingId}`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.id, testMeetingId);
    assert.strictEqual(data.title, 'API Test Meeting');
    assert.ok(Array.isArray(data.segments));
    assert.ok(Array.isArray(data.summaries));
  });

  await t.test('PATCH /api/meetings/:id - update meeting details', async () => {
    const res = await fetch(`${baseUrl}/meetings/${testMeetingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Updated API Test Meeting',
        description: 'New Description'
      })
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.message, 'Meeting updated successfully');

    // Verify update
    const verifyRes = await fetch(`${baseUrl}/meetings/${testMeetingId}`);
    const verifyData = await verifyRes.json();
    assert.strictEqual(verifyData.title, 'Updated API Test Meeting');
    assert.strictEqual(verifyData.description, 'New Description');
  });

  await t.test('POST /api/meetings/:id/recording - upload audio', async () => {
    const formData = new FormData();
    const blob = new Blob(['mock audio binary content'], { type: 'audio/webm' });
    formData.append('audio', blob, 'test.webm');
    formData.append('duration_seconds', '15');

    const res = await fetch(`${baseUrl}/meetings/${testMeetingId}/recording`, {
      method: 'POST',
      body: formData
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.status, 'transcribing');
    assert.ok(data.audio_path);

    // Give it a brief moment for the background mock transcription to finish
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Verify it changed to done
    const checkRes = await fetch(`${baseUrl}/meetings/${testMeetingId}`);
    const checkData = await checkRes.json();
    assert.strictEqual(checkData.status, 'done');
    assert.strictEqual(checkData.duration_seconds, 15);
    assert.strictEqual(checkData.segments.length, 4);
    assert.strictEqual(checkData.segments[0].speaker_label, 'Orang 1');
  });

  await t.test('PATCH /api/meetings/:id/speaker - bulk rename speaker', async () => {
    const res = await fetch(`${baseUrl}/meetings/${testMeetingId}/speaker`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        speaker_label: 'Orang 1',
        speaker_name: 'Budi - Lead PM'
      })
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.message, 'Speaker updated successfully');

    // Verify rename
    const checkRes = await fetch(`${baseUrl}/meetings/${testMeetingId}`);
    const checkData = await checkRes.json();
    assert.strictEqual(checkData.segments[0].speaker_name, 'Budi - Lead PM');
    assert.strictEqual(checkData.segments[2].speaker_name, 'Budi - Lead PM');
    // Orang 2 should still be null
    assert.strictEqual(checkData.segments[1].speaker_name, null);
  });

  await t.test('POST /api/meetings/:id/summary - generate recap/mom', async () => {
    const res = await fetch(`${baseUrl}/meetings/${testMeetingId}/summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'recap' })
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.type, 'recap');
    assert.ok(data.content);

    // Verify summary is in database
    const verifyRes = await fetch(`${baseUrl}/meetings/${testMeetingId}/summary`);
    const verifyData = await verifyRes.json();
    assert.strictEqual(verifyData.length, 1);
    assert.strictEqual(verifyData[0].type, 'recap');
  });

  await t.test('POST /api/meetings/:id/reanalyze - re-trigger transcription', async () => {
    // 1. Manually set status to failed
    await fetch(`${baseUrl}/meetings/${testMeetingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'failed' })
    });

    // 2. Trigger reanalyze
    const res = await fetch(`${baseUrl}/meetings/${testMeetingId}/reanalyze`, {
      method: 'POST'
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.status, 'transcribing');

    // 3. Verify status set back to transcribing in database
    const checkRes = await fetch(`${baseUrl}/meetings/${testMeetingId}`);
    const checkData = await checkRes.json();
    assert.strictEqual(checkData.status, 'transcribing');

    // 4. Poll until the background mock transcription completes to prevent race condition on deletion
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 100));
      const pollRes = await fetch(`${baseUrl}/meetings/${testMeetingId}`);
      const pollData = await pollRes.json();
      if (pollData.status === 'done') break;
    }
  });

  await t.test('POST /api/meetings/:id/cancel - cancel transcription and set status to cancelled', async () => {
    // 1. Trigger reanalyze to set status back to transcribing
    await fetch(`${baseUrl}/meetings/${testMeetingId}/reanalyze`, {
      method: 'POST'
    });

    // 2. Cancel the transcription
    const res = await fetch(`${baseUrl}/meetings/${testMeetingId}/cancel`, {
      method: 'POST'
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.status, 'cancelled');

    // 3. Verify database fields set to cancelled and audio_path preserved
    const checkRes = await fetch(`${baseUrl}/meetings/${testMeetingId}`);
    const checkData = await checkRes.json();
    assert.strictEqual(checkData.status, 'cancelled');
    assert.strictEqual(checkData.progress, 0);
    assert.ok(checkData.audio_path, 'audio_path should be preserved after cancellation');
  });

  await t.test('POST & GET /api/settings - API Key configurations', async () => {
    // 1. Get initial status
    let res = await fetch(`${baseUrl}/settings`);
    let data = await res.json();
    assert.strictEqual(data.gemini_api_key_set, false);

    // 2. Save key
    res = await fetch(`${baseUrl}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gemini_api_key: 'sk_test_api_key' })
    });
    assert.strictEqual(res.status, 200);

    // 3. Verify key is set
    res = await fetch(`${baseUrl}/settings`);
    data = await res.json();
    assert.strictEqual(data.gemini_api_key_set, true);
  });

  await t.test('DELETE /api/meetings/:id - delete meeting', async () => {
    const res = await fetch(`${baseUrl}/meetings/${testMeetingId}`, {
      method: 'DELETE'
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.message, 'Meeting deleted successfully');

    // Verify no longer exists
    const checkRes = await fetch(`${baseUrl}/meetings/${testMeetingId}`);
    assert.strictEqual(checkRes.status, 404);
  });

  // Close the server at the end of all tests
  server.close();
});
