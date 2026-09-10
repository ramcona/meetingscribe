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
          audio: { deviceId: { exact: systemDeviceId } }
        });
      } catch (sysErr) {
        console.warn('System device capture failed, continuing with microphone:', sysErr);
      }
    }

    // 3. Always route through Web Audio API (fixes Mac/BlackHole silent recording bug in MediaRecorder)
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // CRITICAL: Ensure the audio context is running, as it might start suspended if created after async getUserMedia
    if (audioContext.state === 'suspended') {
      await audioContext.resume().catch(e => console.warn('Failed to resume AudioContext:', e));
    }
    console.log('AudioContext state:', audioContext.state);

    const destination = audioContext.createMediaStreamDestination();
    const dummyElements = [];

    // CRITICAL: Force the WebAudio graph to tick by connecting to the physical destination with an inaudible but non-zero volume.
    // Setting this to exactly 0 can trigger Chromium optimizations that prune/silence the audio processing branch.
    const silenceGain = audioContext.createGain();
    silenceGain.gain.value = 0.00001; 
    silenceGain.connect(audioContext.destination);

    // CRITICAL 2: Keep the MediaRecorder alive by feeding a continuous silent oscillator into the destination.
    // Without this, Chrome may treat virtual device streams as "inactive" and output a completely silent WebM!
    const keepAliveOsc = audioContext.createOscillator();
    const keepAliveGain = audioContext.createGain();
    keepAliveGain.gain.value = 0.00001; // completely silent but active
    keepAliveOsc.connect(keepAliveGain);
    keepAliveGain.connect(destination);
    keepAliveOsc.start();

    if (micStream) {
      const micSource = audioContext.createMediaStreamSource(micStream);
      micSource.connect(destination);
      micSource.connect(silenceGain);
    }

    if (systemStream) {
      const systemSource = audioContext.createMediaStreamSource(systemStream);
      systemSource.connect(destination);
      systemSource.connect(silenceGain);
    }

    if (!micStream && !systemStream) {
      throw new Error('Tidak dapat menemukan stream audio. Pastikan mikrofon terhubung dan diizinkan.');
    }

    mixedStream = destination.stream;

    // Give the AudioContext graph a moment to start processing and push data to the stream tracks
    await new Promise(resolve => setTimeout(resolve, 500));

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
