import { pipeline, env } from '@xenova/transformers';
import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dbHelpers } from './db.js';
import { getAudioDuration, normalizeAndRescaleSegments } from './audioUtils.js';
import { isWhisperCppAvailable, transcribeWithWhisperCpp, transcribeLiveChunkWhisperCpp, findWhisperCppBinary } from './whisperCpp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configure local cache directory for ONNX Whisper models
env.cacheDir = path.join(__dirname, '../data/models');
env.allowLocalModels = true;

let whisperPipelineInstance = null;
let whisperPipelineLoading = null; // Promise guard — prevents concurrent init

function getFfmpegPath() {
  const possiblePaths = [
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
    'ffmpeg'
  ];
  for (const p of possiblePaths) {
    if (p !== 'ffmpeg' && fs.existsSync(p)) return p;
  }
  return 'ffmpeg';
}

// Convert audio file (WebM / MP3 / OGG) to 16kHz 16-bit mono WAV required by Whisper audio processor
export function convertAudioToWav(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const ffmpegCmd = getFfmpegPath();
    execFile(ffmpegCmd, [
      '-y',
      '-i', inputPath,
      '-ar', '16000',
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      outputPath
    ], (error) => {
      if (error) {
        return reject(new Error(`Failed to convert audio to WAV for Whisper: ${error.message}`));
      }
      resolve(outputPath);
    });
  });
}

// Read 16kHz PCM WAV file and convert to Float32Array required by Transformers.js in Node.js
export function readWavAudioToFloat32Array(wavPath) {
  const buffer = fs.readFileSync(wavPath);
  let dataOffset = 44;
  for (let i = 0; i < buffer.length - 4; i++) {
    if (buffer.toString('ascii', i, i + 4) === 'data') {
      dataOffset = i + 8;
      break;
    }
  }

  const pcmData = new Int16Array(
    buffer.buffer,
    buffer.byteOffset + dataOffset,
    Math.floor((buffer.length - dataOffset) / 2)
  );

  const float32Array = new Float32Array(pcmData.length);
  for (let i = 0; i < pcmData.length; i++) {
    float32Array[i] = pcmData[i] / 32768.0;
  }

  return float32Array;
}

// Lazy-load Whisper Pipeline with mutex guard to prevent concurrent initialization
async function getWhisperPipeline(modelName = 'Xenova/whisper-tiny') {
  if (whisperPipelineInstance) return whisperPipelineInstance;

  // If already loading, wait for that promise instead of starting a second load
  if (whisperPipelineLoading) {
    console.log('[LocalWhisper] Pipeline loading already in progress, waiting...');
    return await whisperPipelineLoading;
  }

  console.log(`[LocalWhisper] Initializing local ONNX model (${modelName})...`);
  whisperPipelineLoading = pipeline('automatic-speech-recognition', modelName, {
    quantized: true
  }).then(instance => {
    whisperPipelineInstance = instance;
    whisperPipelineLoading = null;
    console.log(`[LocalWhisper] Local ONNX Whisper model loaded successfully.`);
    return instance;
  }).catch(err => {
    whisperPipelineLoading = null; // Reset so next call can retry
    throw err;
  });

  return await whisperPipelineLoading;
}

/**
 * Transcribes an audio file completely offline using local Whisper model.
 * Uses whisper.cpp (Metal GPU) if available, or ONNX Transformers.js as fallback.
 */
export async function transcribeLocalAudio(meetingId, filePath) {
  const isTest = process.env.NODE_ENV === 'test';

  const updateProgress = async (pct) => {
    const meeting = dbHelpers.getMeeting(meetingId);
    if (!meeting || meeting.status !== 'transcribing') {
      console.log(`[LocalWhisper] Transcription for ${meetingId} cancelled by user.`);
      return false;
    }
    dbHelpers.updateMeeting(meetingId, { progress: pct });
    return true;
  };

  if (isTest) {
    console.log(`[LocalWhisper] Test mode detected. Returning mock local segments for ${meetingId}`);
    if (!(await updateProgress(50))) return;
    const mockSegments = [
      { meeting_id: meetingId, speaker_label: 'Orang 1', text: '[Local Whisper] Selamat pagi semuanya, mari kita mulai meeting.', start_time: 0.0, end_time: 4.5, segment_order: 1 },
      { meeting_id: meetingId, speaker_label: 'Orang 2', text: '[Local Whisper] Siap, sistem transkripsi lokal offline sudah aktif.', start_time: 5.0, end_time: 9.2, segment_order: 2 }
    ];
    dbHelpers.addTranscriptSegments(mockSegments);
    dbHelpers.updateMeeting(meetingId, { status: 'done', progress: 100 });
    return;
  }

  // Check if native whisper.cpp binary is available for Metal GPU acceleration
  if (isWhisperCppAvailable()) {
    console.log(`[WhisperCpp] Found native C++ binary at ${findWhisperCppBinary()}. Using Metal GPU acceleration...`);
    try {
      if (!(await updateProgress(20))) return;
      const whisperLang = dbHelpers.getSetting('whisper_language') || 'auto';
      const rawSegments = await transcribeWithWhisperCpp(filePath, { language: whisperLang });
      if (!(await updateProgress(85))) return;

      const segments = rawSegments.map(s => ({
        ...s,
        meeting_id: meetingId
      }));

      const finalCheck = dbHelpers.getMeeting(meetingId);
      if (!finalCheck || finalCheck.status !== 'transcribing') return;

      dbHelpers.addTranscriptSegments(segments);
      dbHelpers.updateMeeting(meetingId, { status: 'done', progress: 100 });
      console.log(`[WhisperCpp] Successfully transcribed ${meetingId} via C++ Metal GPU (${segments.length} segments).`);
      return;
    } catch (cppErr) {
      console.warn(`[WhisperCpp] Native execution failed, falling back to ONNX Transformers.js:`, cppErr.message);
    }
  }

  const tempWavPath = path.join(path.dirname(filePath), `temp_${meetingId}_16k.wav`);

  try {
    if (!(await updateProgress(15))) return;

    // 1. Measure total audio duration
    const actualDuration = await getAudioDuration(filePath);
    if (actualDuration > 0) {
      dbHelpers.updateMeeting(meetingId, { duration_seconds: Math.round(actualDuration) });
    }

    // 2. Convert to 16kHz WAV
    console.log(`[LocalWhisper] Converting audio to 16kHz PCM WAV...`);
    await convertAudioToWav(filePath, tempWavPath);
    if (!(await updateProgress(35))) return;

    // 3. Decode WAV file to Float32Array for Node.js environment
    console.log(`[LocalWhisper] Reading PCM audio samples into Float32Array...`);
    const audioData = readWavAudioToFloat32Array(tempWavPath);

    // 4. Run Whisper local pipeline
    console.log(`[LocalWhisper] Running local Whisper speech recognition...`);
    const transcriber = await getWhisperPipeline('Xenova/whisper-tiny');
    
    if (!(await updateProgress(55))) return;

    // Execute Whisper with timestamp generation
    const output = await transcriber(audioData, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true
    });

    if (!(await updateProgress(85))) return;

    // Clean up temp WAV file
    try {
      if (fs.existsSync(tempWavPath)) fs.unlinkSync(tempWavPath);
    } catch (cleanupErr) {
      console.warn('[LocalWhisper] Warning: Failed to delete temp WAV file:', cleanupErr);
    }

    // 4. Parse Whisper chunks into formatted transcript segments
    let chunks = output.chunks || [];
    if (chunks.length === 0 && output.text) {
      chunks = [{ text: output.text, timestamp: [0, actualDuration || 10] }];
    }

    let currentSpeakerIndex = 1;
    let lastEndTime = 0;

    const rawSegments = chunks.map((chunk, idx) => {
      const startTime = Array.isArray(chunk.timestamp) && chunk.timestamp[0] !== null ? parseFloat(chunk.timestamp[0]) : lastEndTime;
      let endTime = Array.isArray(chunk.timestamp) && chunk.timestamp[1] !== null ? parseFloat(chunk.timestamp[1]) : startTime + 4.0;

      // Simple heuristic speaker diarization on silence pause (>1.8s pause triggers next speaker label)
      if (startTime - lastEndTime > 1.8 && idx > 0) {
        currentSpeakerIndex = (currentSpeakerIndex % 3) + 1;
      }

      lastEndTime = endTime;

      return {
        meeting_id: meetingId,
        speaker_label: `Orang ${currentSpeakerIndex}`,
        speaker_name: null,
        text: (chunk.text || '').trim(),
        start_time: startTime,
        end_time: endTime,
        segment_order: idx + 1
      };
    }).filter(s => s.text.length > 0);

    // Normalize & clamp timestamps
    const segments = normalizeAndRescaleSegments(rawSegments, actualDuration);

    // Final cancel check
    const finalCheck = dbHelpers.getMeeting(meetingId);
    if (!finalCheck || finalCheck.status !== 'transcribing') {
      console.log(`[LocalWhisper] Task for ${meetingId} cancelled. Aborting save.`);
      return;
    }

    dbHelpers.addTranscriptSegments(segments);
    dbHelpers.updateMeeting(meetingId, { status: 'done', progress: 100 });
    console.log(`[LocalWhisper] Successfully transcribed meeting ${meetingId} locally (${segments.length} segments).`);

  } catch (error) {
    console.error(`[LocalWhisper Error] Failed to transcribe meeting ${meetingId}:`, error);

    // Cleanup temp WAV file if exists
    try {
      if (fs.existsSync(tempWavPath)) fs.unlinkSync(tempWavPath);
    } catch (e) {}

    const failCheck = dbHelpers.getMeeting(meetingId);
    if (failCheck && failCheck.status === 'transcribing') {
      dbHelpers.updateMeeting(meetingId, { status: 'failed', progress: 0 });
    }
    throw error;
  }
}

/**
 * Transcribes a short live audio chunk (3-5 seconds) 100% locally using Whisper tiny model.
 */
export async function transcribeChunkLocalWhisper(audioBuffer) {
  const isTest = process.env.NODE_ENV === 'test';
  if (isTest) {
    return 'Mock live chunk transcript text';
  }

  // Use C++ Metal GPU live chunk transcription if available
  if (isWhisperCppAvailable()) {
    try {
      const cppText = await transcribeLiveChunkWhisperCpp(audioBuffer);
      if (cppText && cppText.trim()) return cppText.trim();
    } catch (e) {
      console.warn('[WhisperCpp] Live chunk failed, falling back to ONNX:', e);
    }
  }

  const dataDir = process.env.DATA_DIR || path.join(__dirname, '../data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const id = Date.now() + Math.random().toString(36).substring(2, 6);
  const tempChunkPath = path.join(dataDir, `temp_chunk_${id}.webm`);
  const tempWavPath = path.join(dataDir, `temp_chunk_${id}.wav`);

  try {
    fs.writeFileSync(tempChunkPath, audioBuffer);
    await convertAudioToWav(tempChunkPath, tempWavPath);
    const audioData = readWavAudioToFloat32Array(tempWavPath);

    const transcriber = await getWhisperPipeline('Xenova/whisper-tiny');
    const output = await transcriber(audioData, {
      chunk_length_s: 10,
      return_timestamps: false
    });

    const text = (output.text || '').trim();

    try { if (fs.existsSync(tempChunkPath)) fs.unlinkSync(tempChunkPath); } catch (e) {}
    try { if (fs.existsSync(tempWavPath)) fs.unlinkSync(tempWavPath); } catch (e) {}

    return text;
  } catch (err) {
    console.error('[LocalWhisper Chunk Error]:', err);
    try { if (fs.existsSync(tempChunkPath)) fs.unlinkSync(tempChunkPath); } catch (e) {}
    try { if (fs.existsSync(tempWavPath)) fs.unlinkSync(tempWavPath); } catch (e) {}
    return '';
  }
}

