import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import { dbHelpers } from './db.js';
import { getAudioDuration, normalizeAndRescaleSegments, formatTime } from './audioUtils.js';
import { transcribeLocalAudio } from './localWhisper.js';
import fs from 'fs';

// Get the Gemini API Key
function getApiKey() {
  return dbHelpers.getSetting('gemini_api_key') || process.env.GEMINI_API_KEY;
}

// Get the Gemini model name
function getModelName() {
  return process.env.GEMINI_MODEL || 'gemini-2.0-flash';
}

/**
 * Robust API execution wrapper with exponential backoff retries and fallback model candidates.
 * Specifically mitigates temporary HTTP 503 "Service Unavailable / High Demand", HTTP 429 rate limits, and 404 model availability errors.
 */
async function callGeminiWithRetry(apiCallFn, options = {}) {
  const maxRetries = options.maxRetries || 3;
  const initialDelayMs = options.initialDelayMs || 1500;
  
  // Preferred candidate model list using valid Google Gemini API models
  const primaryModel = getModelName();
  const fallbackModels = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];
  const modelsToTry = [primaryModel, ...fallbackModels.filter(m => m !== primaryModel)];

  let lastError = null;

  for (let mIdx = 0; mIdx < modelsToTry.length; mIdx++) {
    const currentModel = modelsToTry[mIdx];
    console.log(`[Gemini Retry Wrapper] Attempting operation with model: ${currentModel}`);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await apiCallFn(currentModel);
      } catch (error) {
        lastError = error;
        const errMessage = String(error?.message || error);

        // Check if model is not available (404 Not Found / deprecated)
        const isModelNotFound = /404|not found|no longer available|not supported/i.test(errMessage);
        if (isModelNotFound) {
          console.warn(`[Gemini Retry] Model ${currentModel} is not available (404). Skipping to next candidate model...`);
          break; // Try next candidate model immediately
        }

        // Check if error is transient (503 Service Unavailable, 429 Rate Limit, 500, 502, 504, network fetch error)
        const isTransient = /503|429|500|502|504|UNAVAILABLE|HIGH_DEMAND|RESOURCE_EXHAUSTED|fetch failed|econnreset|etimedout/i.test(errMessage);

        if (!isTransient) {
          // Hard error (e.g. invalid API key 400/403), do not retry
          console.error(`[Gemini Error] Non-retryable error encountered on ${currentModel}: ${errMessage}`);
          throw error;
        }

        console.warn(`[Gemini Retry] Attempt ${attempt}/${maxRetries} on model ${currentModel} failed: ${errMessage}`);

        if (attempt < maxRetries) {
          // Exponential backoff with jitter: 1.5s, 3s, 6s + random 0-1000ms
          const backoff = initialDelayMs * Math.pow(2, attempt - 1) + Math.random() * 1000;
          console.log(`[Gemini Retry] High demand/503 encountered. Waiting ${Math.round(backoff)}ms before retrying...`);
          await new Promise(res => setTimeout(res, backoff));
        }
      }
    }

    console.warn(`[Gemini Retry] Model ${currentModel} failed. Switching to fallback model if available...`);
  }

  // If all models and retries failed, throw last error with user friendly explanation
  if (/503|UNAVAILABLE|HIGH_DEMAND/i.test(String(lastError?.message))) {
    throw new Error('Server Gemini sedang mengalami lonjakan trafik tinggi (503 Service Unavailable). Kami telah mencoba beberapa kali secara otomatis. Silakan coba lagi beberapa saat lagi.');
  }
  throw lastError;
}

// Transcribe audio file using Gemini API or Local Whisper
export async function transcribeAudio(meetingId, filePath) {
  const apiKey = getApiKey();
  const isTest = process.env.NODE_ENV === 'test';
  const engine = dbHelpers.getSetting('transcription_engine') || 'auto';

  if (engine === 'local_whisper' || (engine === 'auto' && !apiKey && !isTest)) {
    console.log(`[Transcribe] Directing to local Whisper offline engine (engine=${engine}, keySet=${!!apiKey})...`);
    return await transcribeLocalAudio(meetingId, filePath);
  }

  const updateProgress = async (pct) => {
    const meeting = dbHelpers.getMeeting(meetingId);
    if (!meeting || meeting.status !== 'transcribing') {
      console.log(`[Gemini] Transcription for ${meetingId} cancelled by user. Aborting task.`);
      return false; // Cancelled
    }
    dbHelpers.updateMeeting(meetingId, { progress: pct });
    return true; // Still active
  };

  if (isTest || !apiKey) {
    console.log(`[Gemini] Mocking transcription for meeting ${meetingId}. isTest=${isTest}, keySet=${!!apiKey}`);
    
    // Simulate steps and update progress safely
    if (!(await updateProgress(20))) return;
    await new Promise((resolve) => setTimeout(resolve, isTest ? 5 : 500));
    
    if (!(await updateProgress(60))) return;
    await new Promise((resolve) => setTimeout(resolve, isTest ? 5 : 500));

    if (!(await updateProgress(90))) return;
    await new Promise((resolve) => setTimeout(resolve, isTest ? 5 : 500));

    // Double check status before finalizing mock insertion
    const currentMeeting = dbHelpers.getMeeting(meetingId);
    if (!currentMeeting || currentMeeting.status !== 'transcribing') {
      console.log(`[Gemini] Mock transcription for ${meetingId} cancelled by user. Aborting finalize.`);
      return;
    }

    // Insert mock segments
    const mockSegments = [
      {
        meeting_id: meetingId,
        speaker_label: 'Orang 1',
        text: 'Selamat pagi semuanya, mari kita mulai meeting koordinasi project MeetingScribe.',
        start_time: 0.5,
        end_time: 4.8,
        segment_order: 1
      },
      {
        meeting_id: meetingId,
        speaker_label: 'Orang 2',
        text: 'Selamat pagi, siap. Semua modul dasar sepertinya sudah mulai berjalan.',
        start_time: 5.2,
        end_time: 9.0,
        segment_order: 2
      },
      {
        meeting_id: meetingId,
        speaker_label: 'Orang 1',
        text: 'Bagus. Budi, tolong pastikan database SQLite dan audio mixer siap akhir minggu ini ya.',
        start_time: 9.5,
        end_time: 14.5,
        segment_order: 3
      },
      {
        meeting_id: meetingId,
        speaker_label: 'Orang 2',
        text: 'Baik, saya akan selesaikan database schema dan audio mixing logic.',
        start_time: 15.0,
        end_time: 18.2,
        segment_order: 4
      }
    ];

    dbHelpers.addTranscriptSegments(mockSegments);
    dbHelpers.updateMeeting(meetingId, { status: 'done', progress: 100 });
    return;
  }

  // Real transcription using Gemini
  try {
    if (!(await updateProgress(10))) return;

    // Detect true audio duration on disk first
    let currentMeetingData = dbHelpers.getMeeting(meetingId);
    let audioDuration = currentMeetingData?.duration_seconds || 0;

    if (!audioDuration || audioDuration === 0) {
      console.log(`[Gemini] Calculating exact audio duration for ${filePath}...`);
      const detectedDuration = await getAudioDuration(filePath);
      if (detectedDuration > 0) {
        audioDuration = Math.round(detectedDuration);
        dbHelpers.updateMeeting(meetingId, { duration_seconds: audioDuration });
        console.log(`[Gemini] Updated meeting ${meetingId} audio duration to ${audioDuration}s`);
      }
    }

    const fileManager = new GoogleAIFileManager(apiKey);
    
    console.log(`[Gemini] Uploading ${filePath} to Gemini Files API...`);
    const uploadResult = await fileManager.uploadFile(filePath, {
      mimeType: 'audio/webm',
      displayName: `meeting-${meetingId}`
    });
    console.log(`[Gemini] Uploaded successfully: ${uploadResult.file.uri}`);
    if (!(await updateProgress(30))) return;

    // Wait for the uploaded file to be processed by Google Files API
    let fileState = 'PROCESSING';
    let attempts = 0;
    while (fileState === 'PROCESSING' && attempts < 10) {
      attempts++;
      if (!(await updateProgress(Math.min(30 + attempts * 5, 55)))) return;
      await new Promise(resolve => setTimeout(resolve, 2000));
      const fileInfo = await fileManager.getFile(uploadResult.file.name);
      fileState = fileInfo.state;
      console.log(`[Gemini] File state query attempt ${attempts}: ${fileState}`);
    }
    
    if (fileState !== 'ACTIVE') {
      throw new Error(`File upload processing failed. State: ${fileState}`);
    }
    if (!(await updateProgress(60))) return;

    const durationInfoText = audioDuration > 0
      ? `Durasi total audio ini adalah ${audioDuration} detik (${formatTime(audioDuration)}).\nPENTING: start_time dan end_time HARUS presisi dan berada di dalam rentang 0.0 hingga ${audioDuration}.0 detik. Waktu selesai (end_time) segmen terakhir TIDAK BOLEH melebihi ${audioDuration} detik.`
      : '';

    const prompt = `
      Kamu adalah asisten transkripsi profesional. Dengarkan audio rekaman meeting ini dan buatlah transkrip lengkap.
      Lakukan juga speaker diarization dengan mendeteksi siapa yang sedang berbicara secara konsisten sepanjang audio.
      ${durationInfoText}
      
      Hasilkan output dalam format JSON array of objects. Setiap object wajib memiliki property berikut:
      - speaker_label: string dengan format "Orang 1", "Orang 2", dst. untuk melabeli pembicara secara konsisten (orang yang sama harus mendapat label yang sama).
      - start_time: number (waktu mulai berbicara dalam detik).
      - end_time: number (waktu selesai berbicara dalam detik).
      - text: string verbatim dari ucapan pembicara dalam bahasa aslinya (Indonesia/Inggris campur oke).
      
      PENTING: Balas HANYA dengan JSON array yang valid, tanpa penjelasan markdown prefix \`\`\`json atau suffix apa pun.
    `;

    // Execute content generation with retry and model fallback support
    const response = await callGeminiWithRetry(async (modelName) => {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: modelName });
      console.log(`[Gemini] Invoking model ${modelName} for audio diarization...`);
      return await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [
              {
                fileData: {
                  mimeType: uploadResult.file.mimeType,
                  fileUri: uploadResult.file.uri
                }
              },
              { text: prompt }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: 'application/json'
        }
      });
    });

    if (!(await updateProgress(85))) return;

    const textResponse = response.response.text();
    console.log(`[Gemini] Response received:`, textResponse.slice(0, 200) + '...');

    // Clean up file from Gemini Files API storage
    try {
      await fileManager.deleteFile(uploadResult.file.name);
      console.log(`[Gemini] Deleted file ${uploadResult.file.name} from Files API storage`);
    } catch (cleanupError) {
      console.error(`[Gemini] Warning: Failed to clean up file from Files API:`, cleanupError);
    }

    // Parse JSON
    const parsed = JSON.parse(textResponse);
    if (!Array.isArray(parsed)) {
      throw new Error('Gemini response is not a JSON array');
    }

    // Map raw segments
    const rawSegments = parsed.map((item, index) => ({
      meeting_id: meetingId,
      speaker_label: item.speaker_label || item.speaker || 'Orang 1',
      speaker_name: null,
      text: item.text || '',
      start_time: parseFloat(item.start_time) || 0,
      end_time: parseFloat(item.end_time) || 0,
      segment_order: index + 1
    }));

    // Normalize & rescale timestamps if Gemini hallucinated bloated time values
    const segments = normalizeAndRescaleSegments(rawSegments, audioDuration);

    // Final cancel check
    const finalMeetingCheck = dbHelpers.getMeeting(meetingId);
    if (!finalMeetingCheck || finalMeetingCheck.status !== 'transcribing') {
      console.log(`[Gemini] Transcription for ${meetingId} cancelled by user. Aborting save.`);
      return;
    }

    dbHelpers.addTranscriptSegments(segments);
    dbHelpers.updateMeeting(meetingId, { status: 'done', progress: 100 });
    console.log(`[Gemini] Finished transcription for meeting ${meetingId}`);

  } catch (error) {
    console.error(`[Gemini] Error transcribing meeting ${meetingId}:`, error);
    // Only set to failed if status wasn't reset to draft by cancellation
    const failCheck = dbHelpers.getMeeting(meetingId);
    if (failCheck && failCheck.status === 'transcribing') {
      dbHelpers.updateMeeting(meetingId, { status: 'failed', progress: 0 });
    }
    throw error;
  }
}

// Generate recap or MoM using Gemini API
export async function generateRecapOrMom(meeting, type, language = 'id') {
  const apiKey = getApiKey();
  const isTest = process.env.NODE_ENV === 'test';

  if (isTest || !apiKey) {
    console.log(`[Gemini] Mocking recap/mom for meeting ${meeting.id}. type=${type}, language=${language}`);
    const suffix = language === 'en' ? ' (in English)' : language === 'bilingual' ? ' (Bilingual)' : '';
    if (type === 'mom') {
      return `# Minutes of Meeting (MoM) - ${meeting.title}${suffix}\n\n**Client:** ${meeting.client || 'N/A'}\n\n## 1. Summary\nThis is a mock draft of Minutes of Meeting in language: ${language}.\n\n## 2. Decisions\n- Decision 1 was agreed upon.\n\n## 3. Action Items\n- Budi: Finalize database schema.`;
    } else {
      return `# Ringkasan (Recap) - ${meeting.title}${suffix}\n\n- Project coordination meeting ran smoothly.\n- Database SQLite schema assignment given to Budi.`;
    }
  }

  try {
    // Format transcript segments
    const transcriptText = meeting.segments.map(seg => {
      const name = seg.speaker_name || seg.speaker_label;
      return `[${formatTime(seg.start_time)} - ${formatTime(seg.end_time)}] ${name}: ${seg.text}`;
    }).join('\n');

    let langInstruction = 'Tulis dalam Bahasa Indonesia formal dan profesional dengan format Markdown yang rapi.';
    if (language === 'en') {
      langInstruction = 'Write entirely in formal, professional English with clean Markdown formatting.';
    } else if (language === 'bilingual') {
      langInstruction = 'Write in a professional bilingual format (incorporating both Bahasa Indonesia and English translations/sections) with clean Markdown formatting.';
    }

    let prompt = '';
    if (type === 'mom') {
      prompt = `
        Berdasarkan transkrip meeting berikut, buatkan Minutes of Meeting (MoM) terstruktur yang mencakup:
        1. Ringkasan singkat pertemuan
        2. Poin-poin pembahasan utama
        3. Keputusan yang diambil
        4. Action items (siapa, melakukan apa, tenggat waktu jika disebutkan)
        
        Metadata Meeting:
        - Judul: ${meeting.title}
        - Deskripsi: ${meeting.description || 'N/A'}
        - Klien: ${meeting.client || 'N/A'}
 
        Transkrip:
        ${transcriptText}
 
        ${langInstruction}
      `;
    } else {
      prompt = `
        Berdasarkan transkrip meeting berikut, buatkan Ringkasan (Recap) singkat yang merangkum diskusi dalam 3-5 poin pembahasan utama.
        
        Metadata Meeting:
        - Judul: ${meeting.title}
        - Deskripsi: ${meeting.description || 'N/A'}
        - Klien: ${meeting.client || 'N/A'}
 
        Transkrip:
        ${transcriptText}
 
        ${langInstruction}
      `;
    }

    console.log(`[Gemini] Generating summary of type ${type} for meeting ${meeting.id} in language ${language}...`);
    
    // Call with retry and model fallback support
    return await callGeminiWithRetry(async (modelName) => {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: modelName });
      console.log(`[Gemini] Invoking model ${modelName} for summary generation...`);
      const response = await model.generateContent(prompt);
      return response.response.text();
    });

  } catch (error) {
    console.error(`[Gemini] Error generating summary for meeting ${meeting.id}:`, error);
    throw new Error(`Gagal memproses dengan Gemini API: ${error.message}`);
  }
}

// Helper to build detailed, transcript-driven chapters when offline or fallback is needed
function buildSmartFallbackChapters(meeting, duration) {
  const segments = meeting.segments || [];
  if (segments.length === 0) return [];

  const chunkCount = Math.min(5, Math.max(2, Math.ceil(duration / 300)));
  const chunkSize = duration / chunkCount;
  const chapters = [];

  const fillerPattern = /^(halo|tes|tes tes|suara|masuk|siang|pagi|malam|oke|ya|iya|hallo|check|denger|bisa|terima kasih|makasih)\b/i;

  for (let i = 0; i < chunkCount; i++) {
    const startTime = Math.round(i * chunkSize);
    const endTime = Math.round((i + 1) * chunkSize);

    const chunkSegs = segments.filter(s => s.start_time >= startTime && s.start_time < endTime);
    const targetSegs = chunkSegs.length > 0 ? chunkSegs : segments;

    // Filter out filler / greeting lines
    const contentSegs = targetSegs.filter(s => {
      const txt = s.text.trim();
      return txt.length > 12 && !fillerPattern.test(txt);
    });

    const activeSegs = contentSegs.length > 0 ? contentSegs : targetSegs;
    const combinedText = activeSegs.map(s => s.text).join(' ');

    // Extract meaningful topic keywords (words > 3 chars, excluding common stop words)
    const words = combinedText
      .replace(/[^\w\s\-\.]/gi, '')
      .split(/\s+/)
      .filter(w => w.length > 3 && !/^(yang|untuk|dengan|adalah|akan|pada|bisa|kalau|sudah|karena|tidak|nggak|paling|terkait|dalam|bagaimana|gimana|seperti|persen|mereka|kalian|kamu|bapak|saya|kita|tentang)\b/i.test(w));

    // Select top unique topic keywords
    const topKeywords = [...new Set(words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))].slice(0, 3);

    let title = '';
    if (i === 0) {
      title = topKeywords.length > 0 ? `Pembukaan & Topik ${topKeywords.join(' & ')}` : 'Pembukaan & Sesi Koordinasi Meeting';
    } else if (topKeywords.length > 0) {
      title = `Pembahasan: ${topKeywords.join(' & ')}`;
    } else {
      title = `Pembahasan Sesi Utama ${i + 1}`;
    }

    if (title.length > 50) {
      title = title.substring(0, 47) + '...';
    }

    // Construct informative summary sentence
    let summary = activeSegs.map(s => s.text).slice(0, 2).join('. ').trim();
    if (!summary || summary.length < 15) {
      summary = `Diskusi dan pembahasan poin penting pada durasi ${formatTime(startTime)} hingga ${formatTime(endTime)}.`;
    } else if (summary.length > 150) {
      summary = summary.substring(0, 147) + '...';
    }

    chapters.push({
      title: title,
      summary: summary,
      start_time: startTime,
      end_time: endTime,
      chapter_order: i + 1
    });
  }

  return chapters;
}

// Generate topic chapters / agenda markers using Gemini API or smart transcript extraction
export async function generateChapters(meeting) {
  const apiKey = getApiKey();
  const isTest = process.env.NODE_ENV === 'test';

  if (!meeting.segments || meeting.segments.length === 0) {
    return [];
  }

  const duration = meeting.duration_seconds || Math.max(...meeting.segments.map(s => s.end_time));

  if (isTest) {
    console.log(`[Chapters] Test mode active for meeting ${meeting.id}`);
    const chaps = [
      { title: 'Pembukaan & Koordinasi Team', summary: 'Diskusi awal dan pembukaan meeting', start_time: 0, end_time: Math.min(duration, 300), chapter_order: 1 },
      { title: 'Pembahasan Utama & Action Items', summary: 'Diskusi teknis dan pembagian tugas', start_time: Math.min(duration, 305), end_time: duration, chapter_order: 2 }
    ];
    dbHelpers.addChapters(meeting.id, chaps);
    return chaps;
  }

  if (apiKey) {
    try {
      const transcriptText = meeting.segments.map(seg => {
        const name = seg.speaker_name || seg.speaker_label;
        return `[${formatTime(seg.start_time)} - ${formatTime(seg.end_time)}] ${name}: ${seg.text}`;
      }).join('\n');

      const prompt = `
        Berdasarkan transkrip meeting berikut, analisa pembicaraan secara profesional dan bagi diskusi menjadi 3 hingga 6 Bab (Chapters / Topic Bookmarks) terstruktur.
        
        ATURAN PENTING JUDUL BAB (title):
        1. DILARANG MENGGUNAKAN UCAPAN / BANTER / SALAM BERSUARA SEPERTI "Halo", "Tes tes suara", "Siang Pak", "Oke", "Bisa take control" SEBAGAI JUDUL BAB.
        2. Judul Bab HARUS BERUPA JUDUL TOPIK / AGENDA UTAMA RESMI (Contoh: "Pembahasan Arsitektur External Storage", "Diskusi Mekanisme Paging Data", "Review Akses Kontrol & System", "Pembukaan & Sesi Koordinasi").
        3. Setiap bab harus mencerminkan substansi topik utama yang sedang dibahas pada rentang waktu tersebut.
        4. Ringkasan (summary) HARUS berisi 1-2 kalimat deskriptif penjelasan poin atau keputusan yang dibahas di bab tersebut.
        
        Output WAJIB berupa JSON array of objects dengan struktur:
        - title: string judul bab yang spesifik, formal, dan informatif (3-6 kata).
        - summary: string penjelasan rinci poin-poin yang dibahas.
        - start_time: number (waktu mulai bab dalam detik).
        - end_time: number (waktu selesai bab dalam detik).
        
        Metadata Meeting:
        - Judul: ${meeting.title}
        - Durasi Total: ${duration} detik
        
        Transkrip Lengkap:
        ${transcriptText}
        
        Balas HANYA dengan JSON array yang valid tanpa markdown.
      `;

      const response = await callGeminiWithRetry(async (modelName) => {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: modelName });
        return await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' }
        });
      });

      const parsed = JSON.parse(response.response.text());
      if (Array.isArray(parsed) && parsed.length > 0) {
        const sanitized = parsed.map((item, idx) => ({
          title: item.title || `Pembahasan Topik ${idx + 1}`,
          summary: item.summary || '',
          start_time: Math.min(duration, Math.max(0, parseFloat(item.start_time) || 0)),
          end_time: Math.min(duration, Math.max(0, parseFloat(item.end_time) || duration)),
          chapter_order: idx + 1
        }));
        dbHelpers.addChapters(meeting.id, sanitized);
        return sanitized;
      }
    } catch (err) {
      console.error(`[Chapters Error] Failed to generate chapters with Gemini AI:`, err);
    }
  }

  // Smart transcript-driven fallback if offline or API error occurred
  const smartChaps = buildSmartFallbackChapters(meeting, duration);
  dbHelpers.addChapters(meeting.id, smartChaps);
  return smartChaps;
}
