import test from 'node:test';
import assert from 'node:assert';

// Import function to test
import { getAudioInputDevices, startAudioRecording } from '../utils/audioMixer.js';

// Mock Browser environment APIs safely on globalThis
Object.defineProperty(globalThis, 'navigator', {
  value: {
    mediaDevices: {
      getUserMedia: async () => ({
        getTracks: () => [{ stop: () => {} }],
        getAudioTracks: () => [{ stop: () => {} }],
        getVideoTracks: () => [{ stop: () => {} }]
      }),
      enumerateDevices: async () => [
        { kind: 'audioinput', deviceId: 'default', label: 'Default Microphone' },
        { kind: 'videoinput', deviceId: 'cam', label: 'Camera' }
      ]
    }
  },
  configurable: true,
  writable: true
});

global.window = {
  AudioContext: class {
    constructor() {
      this.state = 'suspended';
      this.destination = {};
    }
    createMediaStreamSource() { return { connect: () => {} }; }
    createMediaStreamDestination() { return { stream: {} }; }
    createGain() { 
      return { 
        gain: { value: 0 }, 
        connect: () => {} 
      }; 
    }
    createOscillator() { 
      return { 
        connect: () => {}, 
        start: () => {} 
      }; 
    }
    resume() { 
      this.state = 'running';
      return Promise.resolve(); 
    }
    close() {}
  }
};
global.MediaRecorder = class {
  constructor(stream, options) {
    this.stream = stream;
    this.options = options;
  }
  static isTypeSupported(type) { return true; }
};

test('Client Audio Mixer Utilities test', async (t) => {
  await t.test('getAudioInputDevices lists only audio inputs', async () => {
    const devices = await getAudioInputDevices();
    assert.strictEqual(devices.length, 1);
    assert.strictEqual(devices[0].label, 'Default Microphone');
  });

  await t.test('startAudioRecording offline mode (mic only)', async () => {
    const result = await startAudioRecording({ micDeviceId: 'default' });
    assert.ok(result.recorder);
    assert.ok(result.micStream);
    assert.strictEqual(result.systemStream, null);
  });

  await t.test('startAudioRecording exclusive system mode (no mic)', async () => {
    const result = await startAudioRecording({ micDeviceId: '', systemDeviceId: 'blackhole' });
    assert.ok(result.recorder);
    assert.strictEqual(result.micStream, null);
    assert.ok(result.systemStream);
  });
});
