import test from 'node:test';
import assert from 'node:assert';

// Set environment to test
process.env.NODE_ENV = 'test';

import { app, server } from '../src/index.js';

test('End-to-End Integration and Walkthrough Validation', async (t) => {
  const PORT = server.address().port;
  const baseUrl = `http://localhost:${PORT}/api`;
  
  console.log('\n=== STARTING E2E WALKTHROUGH ===');

  // Step 1: Initialize settings
  console.log('[E2E] Step 1: Config Gemini API Key');
  const setSettingsRes = await fetch(`${baseUrl}/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gemini_api_key: 'sk_e2e_test_key' })
  });
  assert.strictEqual(setSettingsRes.status, 200);

  // Step 2: Create a meeting draft
  console.log('[E2E] Step 2: Creating new meeting draft');
  const createRes = await fetch(`${baseUrl}/meetings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'E2E Strategic Sync',
      description: 'Discussing local-first audio transcription architectures',
      client: 'Antigravity QA',
      meeting_type: 'online'
    })
  });
  assert.strictEqual(createRes.status, 201);
  const { id: meetingId } = await createRes.json();
  console.log(`[E2E] Meeting created with ID: ${meetingId}`);

  // Step 3: Upload recording audio
  console.log('[E2E] Step 3: Simulating recording file upload');
  const formData = new FormData();
  const blob = new Blob(['mock audio wave content'], { type: 'audio/webm' });
  formData.append('audio', blob, 'meeting_audio.webm');
  formData.append('duration_seconds', '45');
  
  const uploadRes = await fetch(`${baseUrl}/meetings/${meetingId}/recording`, {
    method: 'POST',
    body: formData
  });
  assert.strictEqual(uploadRes.status, 200);
  const uploadData = await uploadRes.json();
  assert.strictEqual(uploadData.status, 'transcribing');
  console.log('[E2E] Upload complete, transcription job triggered in background...');

  // Step 4: Poll status until transcribing is done
  console.log('[E2E] Step 4: Polling transcription status...');
  let maxAttempts = 10;
  let isDone = false;
  let meetingDetail = null;

  while (maxAttempts > 0 && !isDone) {
    const detailRes = await fetch(`${baseUrl}/meetings/${meetingId}`);
    meetingDetail = await detailRes.json();
    console.log(`[E2E] Polling... Status: ${meetingDetail.status} (attempts left: ${maxAttempts})`);
    
    if (meetingDetail.status === 'done') {
      isDone = true;
      break;
    } else if (meetingDetail.status === 'failed') {
      assert.fail('Transcription job failed');
    }
    
    await new Promise(resolve => setTimeout(resolve, 300));
    maxAttempts--;
  }

  assert.strictEqual(isDone, true, 'Transcription should complete successfully');
  console.log(`[E2E] Transcription done! Generated ${meetingDetail.segments.length} segments`);

  // Step 5: Verify speaker diarization labels
  console.log('[E2E] Step 5: Verifying speaker diarization labels');
  const firstSegment = meetingDetail.segments[0];
  assert.strictEqual(firstSegment.speaker_label, 'Orang 1');
  assert.strictEqual(firstSegment.speaker_name, null);
  console.log(`[E2E] Segment 1 speaker label: "${firstSegment.speaker_label}"`);

  // Step 6: Rename speaker label to name
  console.log('[E2E] Step 6: Renaming speaker "Orang 1" -> "Lead PM Alice"');
  const renameRes = await fetch(`${baseUrl}/meetings/${meetingId}/speaker`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      speaker_label: 'Orang 1',
      speaker_name: 'Lead PM Alice'
    })
  });
  assert.strictEqual(renameRes.status, 200);

  // Re-verify rename
  const verifyRenameRes = await fetch(`${baseUrl}/meetings/${meetingId}`);
  const verifyRenameData = await verifyRenameRes.json();
  assert.strictEqual(verifyRenameData.segments[0].speaker_name, 'Lead PM Alice');
  assert.strictEqual(verifyRenameData.segments[2].speaker_name, 'Lead PM Alice');
  console.log('[E2E] Speaker renamed successfully in all segments');

  // Step 7: Generate Minutes of Meeting (MoM)
  console.log('[E2E] Step 7: Requesting AI Minutes of Meeting (MoM) generation');
  const momRes = await fetch(`${baseUrl}/meetings/${meetingId}/summary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'mom' })
  });
  assert.strictEqual(momRes.status, 200);
  const momData = await momRes.json();
  assert.ok(momData.content);
  console.log('[E2E] AI MoM generated successfully');

  // Step 8: Clean up by deleting the meeting
  console.log('[E2E] Step 8: Deleting meeting and verify database cascade');
  const deleteRes = await fetch(`${baseUrl}/meetings/${meetingId}`, {
    method: 'DELETE'
  });
  assert.strictEqual(deleteRes.status, 200);

  // Check if meeting detail returns 444 or 404
  const checkDeletedRes = await fetch(`${baseUrl}/meetings/${meetingId}`);
  assert.strictEqual(checkDeletedRes.status, 404);
  console.log('[E2E] Meeting deleted and database cleaned up successfully');
  
  console.log('=== E2E WALKTHROUGH COMPLETED SUCCESSFULLY ===\n');

  server.close();
});
