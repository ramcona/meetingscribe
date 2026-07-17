import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import { dbHelpers } from './db.js';
import fs from 'fs';

// Helper to format seconds to [MM:SS]
function formatTime(seconds) {
  if (seconds === undefined || seconds === null) return '00:00';
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// Get the Gemini API Key
function getApiKey() {
  return dbHelpers.getSetting('gemini_api_key') || process.env.GEMINI_API_KEY;
}

// Get the Gemini model name
function getModelName() {
  return process.env.GEMINI_MODEL || 'gemini-3.5-flash';
}

// Transcribe audio file using Gemini API
export async function transcribeAudio(meetingId, filePath) {
  const apiKey = getApiKey();
  const isTest = process.env.NODE_ENV === 'test';

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
    const fileManager = new GoogleAIFileManager(apiKey);
    
    console.log(`[Gemini] Uploading ${filePath} to Gemini Files API...`);
    const uploadResult = await fileManager.uploadFile(filePath, {
      mimeType: 'audio/webm',
      displayName: `meeting-${meetingId}`
    });
    console.log(`[Gemini] Uploaded successfully: ${uploadResult.file.uri}`);
    if (!(await updateProgress(30))) return;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: getModelName() });

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

    const prompt = `
      Kamu adalah asisten transkripsi profesional. Dengarkan audio rekaman meeting ini dan buatlah transkrip lengkap.
      Lakukan juga speaker diarization dengan mendeteksi siapa yang sedang berbicara secara konsisten sepanjang audio.
      
      Hasilkan output dalam format JSON array of objects. Setiap object wajib memiliki property berikut:
      - speaker_label: string dengan format "Orang 1", "Orang 2", dst. untuk melabeli pembicara secara konsisten (orang yang sama harus mendapat label yang sama).
      - start_time: number (waktu mulai berbicara dalam detik, bisa estimasi).
      - end_time: number (waktu selesai berbicara dalam detik, bisa estimasi).
      - text: string verbatim dari ucapan pembicara dalam bahasa aslinya (Indonesia/Inggris campur oke).
      
      PENTING: Balas HANYA dengan JSON array yang valid, tanpa penjelasan markdown prefix \`\`\`json atau suffix apa pun.
    `;

    console.log(`[Gemini] Invoking ${getModelName()} for diarization...`);
    const response = await model.generateContent({
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
    if (!(await updateProgress(85))) return;

    const textResponse = response.response.text();
    console.log(`[Gemini] Response received:`, textResponse);

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

    // Save to database
    const segments = parsed.map((item, index) => ({
      meeting_id: meetingId,
      speaker_label: item.speaker_label || item.speaker || 'Orang 1',
      speaker_name: null,
      text: item.text || '',
      start_time: parseFloat(item.start_time) || 0,
      end_time: parseFloat(item.end_time) || 0,
      segment_order: index + 1
    }));

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
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: getModelName() });

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
    const response = await model.generateContent(prompt);
    return response.response.text();
  } catch (error) {
    console.error(`[Gemini] Error generating summary for meeting ${meeting.id}:`, error);
    throw new Error(`Gagal memproses dengan Gemini API: ${error.message}`);
  }
}
