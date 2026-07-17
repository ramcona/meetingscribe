/**
 * Audio Mixer & Recorder Utilities for MeetingScribe
 * Handles device enumeration, AudioContext track mixing, and MediaRecorder setup.
 */

// Enumerate input audio devices
export async function getAudioInputDevices() {
  try {
    // Request permission first to get labels
    await navigator.mediaDevices.getUserMedia({ audio: true });
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(device => device.kind === 'audioinput');
  } catch (error) {
    console.error('Error enumerating audio devices:', error);
    return [];
  }
}

// Start capturing and mixing audio streams
export async function startAudioRecording({ micDeviceId, systemDeviceId, useTabCapture = false }) {
  let micStream = null;
  let systemStream = null;
  let audioContext = null;
  let mixedStream = null;
  let recorder = null;

  try {
    // 1. Capture Microphone (if selected, or if no other source is selected as fallback)
    if (micDeviceId || (!systemDeviceId && !useTabCapture)) {
      const micConstraints = {
        audio: micDeviceId ? { deviceId: { exact: micDeviceId } } : true
      };
      micStream = await navigator.mediaDevices.getUserMedia(micConstraints);
    }

    // 2. Capture System/Participant Audio
    if (useTabCapture) {
      // Capture Chrome Tab audio (forces display media prompt)
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true, // required by browser spec, we will drop it
        audio: true
      });
      
      // Filter out video track immediately
      const videoTracks = displayStream.getVideoTracks();
      videoTracks.forEach(track => track.stop());

      const audioTracks = displayStream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error('No audio track shared in tab capture.');
      }
      systemStream = new MediaStream(audioTracks);
    } else if (systemDeviceId) {
      // Capture secondary device like BlackHole
      systemStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: systemDeviceId } }
      });
    }

    // 3. Mix streams if we have both, or select the active single stream
    if (micStream && systemStream) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      const micSource = audioContext.createMediaStreamSource(micStream);
      const systemSource = audioContext.createMediaStreamSource(systemStream);
      const destination = audioContext.createMediaStreamDestination();

      // Connect both inputs to the destination (automatic mixing)
      micSource.connect(destination);
      systemSource.connect(destination);

      mixedStream = destination.stream;
    } else if (systemStream) {
      // Only system audio (e.g. BlackHole only)
      mixedStream = systemStream;
    } else {
      // Only microphone audio
      mixedStream = micStream;
    }

    // 4. Create MediaRecorder
    // We prefer audio/webm;codecs=opus for efficient speech compression
    let mimeType = 'audio/webm;codecs=opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'audio/webm';
    }
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'audio/ogg;codecs=opus';
    }
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = ''; // fallback to default
    }

    // Record at 48kbps (perfect for speech, fast upload)
    recorder = new MediaRecorder(mixedStream, {
      mimeType,
      audioBitsPerSecond: 48000
    });

    return {
      recorder,
      micStream,
      systemStream,
      mixedStream,
      audioContext,
      mimeType
    };
  } catch (error) {
    // Cleanup if any step fails
    if (micStream) micStream.getTracks().forEach(t => t.stop());
    if (systemStream) systemStream.getTracks().forEach(t => t.stop());
    if (audioContext) audioContext.close();
    throw error;
  }
}
