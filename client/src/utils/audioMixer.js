/**
 * Audio Mixer & Recorder Utilities for MeetingScribe
 * Handles device enumeration, AudioContext track mixing, and MediaRecorder setup.
 */

// Enumerate input audio devices
export async function getAudioInputDevices() {
  try {
    // Request permission first to get labels, then release temporary stream
    const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    tempStream.getTracks().forEach(track => track.stop());

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
    // 1. Capture Microphone (if requested or if no system source is selected)
    if (micDeviceId || (!systemDeviceId && !useTabCapture)) {
      try {
        const micConstraints = {
          audio: (micDeviceId && micDeviceId !== 'default') ? { deviceId: { ideal: micDeviceId } } : true
        };
        micStream = await navigator.mediaDevices.getUserMedia(micConstraints);
      } catch (micErr) {
        console.warn('Microphone stream error with specified ID, falling back to default mic:', micErr);
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
    }

    // 2. Capture System/Participant Audio
    if (useTabCapture) {
      try {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true
        });
        displayStream.getVideoTracks().forEach(track => track.stop());
        const audioTracks = displayStream.getAudioTracks();
        if (audioTracks.length > 0) {
          systemStream = new MediaStream(audioTracks);
        }
      } catch (tabErr) {
        console.warn('Tab capture cancelled or unavailable:', tabErr);
      }
    } else if (systemDeviceId && systemDeviceId !== 'default' && systemDeviceId !== micDeviceId) {
      try {
        systemStream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { ideal: systemDeviceId } }
        });
      } catch (sysErr) {
        console.warn('System device capture failed, continuing with microphone:', sysErr);
      }
    }

    // 3. Mix streams if we have both, or select active single stream
    if (micStream && systemStream) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      const micSource = audioContext.createMediaStreamSource(micStream);
      const systemSource = audioContext.createMediaStreamSource(systemStream);
      const destination = audioContext.createMediaStreamDestination();

      micSource.connect(destination);
      systemSource.connect(destination);

      mixedStream = destination.stream;
    } else if (systemStream) {
      mixedStream = systemStream;
    } else if (micStream) {
      mixedStream = micStream;
    } else {
      throw new Error('Tidak dapat menemukan stream audio. Pastikan mikrofon terhubung dan diizinkan.');
    }

    // 4. Create MediaRecorder
    let mimeType = 'audio/webm;codecs=opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'audio/webm';
    }
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'audio/ogg;codecs=opus';
    }
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = '';
    }

    recorder = new MediaRecorder(mixedStream, mimeType ? { mimeType, audioBitsPerSecond: 48000 } : undefined);

    return {
      recorder,
      micStream,
      systemStream,
      mixedStream,
      audioContext,
      mimeType
    };
  } catch (error) {
    if (micStream) micStream.getTracks().forEach(t => t.stop());
    if (systemStream) systemStream.getTracks().forEach(t => t.stop());
    if (audioContext) audioContext.close();
    throw error;
  }
}
