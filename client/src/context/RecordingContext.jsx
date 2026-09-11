import React, { createContext, useContext, useState, useRef, useEffect } from 'react';
import { getAudioInputDevices, startAudioRecording } from '../utils/audioMixer';

const RecordingContext = createContext(null);

export function RecordingProvider({ children }) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [meetingId, setMeetingId] = useState(null);
  const [meetingTitle, setMeetingTitle] = useState('');
  const [duration, setDuration] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Device selections
  const [devices, setDevices] = useState([]);
  const [micId, setMicId] = useState('');
  const [systemId, setSystemId] = useState('');
  const [useTabCapture, setUseTabCapture] = useState(false);

  // Stream previews
  const [micStreamPreview, setMicStreamPreview] = useState(null);
  const [systemStreamPreview, setSystemStreamPreview] = useState(null);

  // Live Transcript (Beta) states
  const [isLiveTranscriptEnabled, setIsLiveTranscriptEnabled] = useState(false);
  const [liveEngine, setLiveEngine] = useState('whisper'); // 'whisper' (local ONNX) | 'webspeech' (browser API)
  const [liveTranscriptLang, setLiveTranscriptLang] = useState('id-ID');
  const [liveTranscriptSegments, setLiveTranscriptSegments] = useState([]);
  const [interimText, setInterimText] = useState('');
  const [liveTranscriptError, setLiveTranscriptError] = useState('');

  // Recording refs
  const recorderRef = useRef(null);
  const recognitionRef = useRef(null);
  const liveChunkRecorderRef = useRef(null);
  const activeStreamsRef = useRef({ mic: null, system: null, mixed: null });
  const audioContextRef = useRef(null);
  const timerRef = useRef(null);
  const chunksRef = useRef([]);
  const durationRef = useRef(0); // always-current duration for live transcript timestamps

  const isSpeechSupported = typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  const shouldRestartRef = useRef(true);

  // Notify Electron main process when recording starts/stops (updates tray icon and menu)
  useEffect(() => {
    if (window.electronAPI && window.electronAPI.notifyRecordingState) {
      window.electronAPI.notifyRecordingState(isRecording);
    }
  }, [isRecording]);

  // 1. Local Whisper Real-Time Chunk Streaming Effect (100% Offline Local Machine)
  useEffect(() => {
    if (!isRecording || isPaused || !isLiveTranscriptEnabled || liveEngine !== 'whisper') {
      if (liveChunkRecorderRef.current && liveChunkRecorderRef.current.state !== 'inactive') {
        try { liveChunkRecorderRef.current.stop(); } catch (e) {}
        liveChunkRecorderRef.current = null;
      }
      return;
    }

    const streams = activeStreamsRef.current;
    const targetStream = streams.mixed || streams.mic;
    if (!targetStream) return;

    const mimeType = ['audio/webm;codecs=opus', 'audio/webm'].find(
      t => MediaRecorder.isTypeSupported(t)
    ) || '';

    let isActive = true;
    let cycleTimeout = null;

    // ── Stop/start cycle ────────────────────────────────────────────────────
    // Each cycle creates a BRAND NEW MediaRecorder so every blob has its own
    // WebM initialization segment and is independently decodable by ffmpeg.
    // Prepending the init segment to timesliced chunks is unreliable because
    // cluster timestamps overlap and ffmpeg rejects the data as invalid.
    const runCycle = () => {
      if (!isActive) return;

      const cycleChunks = [];
      let recorder;

      try {
        recorder = new MediaRecorder(targetStream, mimeType ? { mimeType } : {});
      } catch (err) {
        setLiveTranscriptError('Gagal memulai live transcript: ' + err.message);
        return;
      }

      liveChunkRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) cycleChunks.push(e.data);
      };

      recorder.onstop = async () => {
        if (!isActive) return;

        if (cycleChunks.length > 0) {
          const blob = new Blob(cycleChunks, { type: mimeType || 'audio/webm' });

          if (blob.size >= 1000) {
            const formData = new FormData();
            formData.append('audio_chunk', blob, 'chunk.webm');

            try {
              const res = await fetch('http://localhost:3001/api/live-whisper-chunk', {
                method: 'POST',
                body: formData
              });
              if (res.ok) {
                const data = await res.json();
                if (data.text && data.text.trim()) {
                  setLiveTranscriptSegments(prev => [
                    ...prev,
                    {
                      id: Date.now() + '-' + Math.random().toString(36).substring(2, 6),
                      timestamp: durationRef.current,
                      text: data.text.trim(),
                      isFinal: true
                    }
                  ]);
                }
              }
            } catch (err) {
              console.warn('[LiveWhisper] Chunk fetch error:', err);
            }
          }
        }

        // Start next cycle immediately after onstop
        if (isActive) runCycle();
      };

      recorder.start();
      setLiveTranscriptError('');

      // Stop after 5 seconds → triggers onstop → sends blob → starts next cycle
      cycleTimeout = setTimeout(() => {
        if (recorder.state === 'recording') {
          try { recorder.stop(); } catch (e) {}
        }
      }, 5000);
    };

    runCycle();

    return () => {
      isActive = false;
      if (cycleTimeout) clearTimeout(cycleTimeout);
      if (liveChunkRecorderRef.current && liveChunkRecorderRef.current.state !== 'inactive') {
        try { liveChunkRecorderRef.current.stop(); } catch (e) {}
        liveChunkRecorderRef.current = null;
      }
    };
  }, [isRecording, isPaused, isLiveTranscriptEnabled, liveEngine]);

  // 2. Web Speech Recognition Effect (Fallback for browser mode)
  useEffect(() => {
    if (!isRecording || isPaused || !isLiveTranscriptEnabled || liveEngine !== 'webspeech') {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch (e) {}
        recognitionRef.current = null;
      }
      setInterimText('');
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setLiveTranscriptError('Web Speech API live transcript tidak didukung di environment ini.');
      return;
    }

    shouldRestartRef.current = true;
    let recognition;
    try {
      recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = liveTranscriptLang;

      recognition.onresult = (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            if (transcript.trim()) {
              setLiveTranscriptSegments(prev => [
                ...prev,
                {
                  id: Date.now() + '-' + Math.random().toString(36).substring(2, 6),
                  timestamp: duration,
                  text: transcript.trim(),
                  isFinal: true
                }
              ]);
            }
          } else {
            interim += transcript;
          }
        }
        setInterimText(interim);
      };

      recognition.onerror = (err) => {
        console.warn('[LiveTranscript] SpeechRecognition error:', err.error);
        if (err.error === 'network') {
          shouldRestartRef.current = false;
          setLiveTranscriptError('Koneksi Web Speech Google tidak tersedia di Electron environment ini. Live transcript dapat dicatat sebagai draft.');
        } else if (err.error === 'not-allowed') {
          shouldRestartRef.current = false;
          setLiveTranscriptError('Izin mikrofon untuk Live Speech Recognition ditolak.');
        } else if (err.error === 'no-speech') {
          // Normal timeout when quiet, allow restart
        } else {
          setLiveTranscriptError(`Live speech recognition: ${err.error}`);
        }
      };

      recognition.onend = () => {
        if (isRecording && !isPaused && isLiveTranscriptEnabled && recognitionRef.current && shouldRestartRef.current) {
          setTimeout(() => {
            if (isRecording && !isPaused && isLiveTranscriptEnabled && recognitionRef.current && shouldRestartRef.current) {
              try {
                recognition.start();
              } catch (e) {}
            }
          }, 500);
        }
      };

      recognition.start();
      recognitionRef.current = recognition;
      setLiveTranscriptError('');
    } catch (err) {
      console.error('[LiveTranscript] Failed to start SpeechRecognition:', err);
      setLiveTranscriptError(err.message || 'Gagal memulai Live Speech Recognition.');
    }

    return () => {
      shouldRestartRef.current = false;
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch (e) {}
        recognitionRef.current = null;
      }
      setInterimText('');
    };
  }, [isRecording, isPaused, isLiveTranscriptEnabled, liveTranscriptLang]);


  useEffect(() => {
    loadDevices();
  }, []);

  const loadDevices = async () => {
    const inputDevices = await getAudioInputDevices();
    setDevices(inputDevices);
    if (inputDevices.length > 0) {
      const defaultMic = inputDevices.find(d => d.deviceId === 'default') || inputDevices[0];
      setMicId(prev => prev || defaultMic.deviceId);

      const blackhole = inputDevices.find(d => d.label.toLowerCase().includes('blackhole'));
      if (blackhole) {
        setSystemId(prev => prev || blackhole.deviceId);
      }
    }
  };

  const stopPreviews = () => {
    if (micStreamPreview) {
      micStreamPreview.getTracks().forEach(t => t.stop());
      setMicStreamPreview(null);
    }
    if (systemStreamPreview) {
      systemStreamPreview.getTracks().forEach(t => t.stop());
      setSystemStreamPreview(null);
    }
  };

  const stopRecordingResources = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    
    const streams = activeStreamsRef.current;
    if (streams.mic) streams.mic.getTracks().forEach(t => t.stop());
    if (streams.system) streams.system.getTracks().forEach(t => t.stop());
    if (streams.mixed) {
      streams.mixed.getTracks().forEach(t => t.stop());
      if (streams.mixed._dummyAudioElements) {
        streams.mixed._dummyAudioElements.forEach(el => {
          el.pause();
          el.srcObject = null;
        });
      }
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    activeStreamsRef.current = { mic: null, system: null, mixed: null };
    recorderRef.current = null;
  };

  const startRecording = async (targetMeetingId, title = '') => {
    setErrorMessage('');
    stopPreviews();

    try {
      const config = await startAudioRecording({
        micDeviceId: micId,
        systemDeviceId: !useTabCapture ? systemId : null,
        useTabCapture
      });

      recorderRef.current = config.recorder;
      activeStreamsRef.current = {
        mic: config.micStream,
        system: config.systemStream,
        mixed: config.mixedStream
      };
      audioContextRef.current = config.audioContext;

      chunksRef.current = [];
      
      recorderRef.current.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorderRef.current.start(1000);
      setIsRecording(true);
      setIsPaused(false);
      setMeetingId(targetMeetingId);
      setMeetingTitle(title || 'Rekaman Meeting');
      setDuration(0);

      try {
        await fetch(`http://localhost:3001/api/meetings/${targetMeetingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'recording',
            recording_started_at: new Date().toISOString()
          })
        });
      } catch (patchErr) {
        console.error('Failed to update status on start:', patchErr);
      }

      timerRef.current = setInterval(() => {
        setDuration(prev => { durationRef.current = prev + 1; return prev + 1; });
      }, 1000);

    } catch (err) {
      console.error('Error starting recording:', err);
      setErrorMessage(err.message || 'Gagal memulai perekaman. Pastikan izin microphone dan system audio telah diberikan.');
      loadDevices();
    }
  };

  const pauseRecording = () => {
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      recorderRef.current.pause();
      setIsPaused(true);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const resumeRecording = () => {
    if (recorderRef.current && recorderRef.current.state === 'paused') {
      recorderRef.current.resume();
      setIsPaused(false);
      timerRef.current = setInterval(() => {
        setDuration(prev => { durationRef.current = prev + 1; return prev + 1; });
      }, 1000);
    }
  };

  const stopAndSaveRecording = async (onSuccess) => {
    if (!recorderRef.current || !isRecording) return;

    if (timerRef.current) clearInterval(timerRef.current);
    setIsRecording(false);
    setIsPaused(false);
    setUploading(true);

    const activeMeetingId = meetingId;

    // Trigger stop on recorder
    const currentRecorder = recorderRef.current;
    currentRecorder.stop();

    // Wait short tick for final data chunk
    await new Promise(res => setTimeout(res, 200));

    if (!chunksRef.current || chunksRef.current.length === 0) {
      console.warn('No audio chunks recorded.');
      stopRecordingResources();
      setUploading(false);
      setErrorMessage('Tidak ada data audio terekam. Pastikan izin mikrofon telah diberikan.');
      return;
    }

    const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
    stopRecordingResources();

    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');
    formData.append('duration_seconds', duration.toString());
    
    const startedAt = new Date(Date.now() - duration * 1000).toISOString();
    formData.append('recording_started_at', startedAt);

    try {
      // Save live transcript segments if captured
      if (liveTranscriptSegments && liveTranscriptSegments.length > 0) {
        try {
          await fetch(`http://localhost:3001/api/meetings/${activeMeetingId}/live-transcript`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ segments: liveTranscriptSegments })
          });
        } catch (liveErr) {
          console.error('Failed to save live transcript segments:', liveErr);
        }
      }

      const res = await fetch(`http://localhost:3001/api/meetings/${activeMeetingId}/recording`, {
        method: 'POST',
        body: formData
      });

      if (res.ok) {
        setUploading(false);
        setMeetingId(null);
        if (onSuccess) onSuccess(activeMeetingId);
      } else {
        const errData = await res.json();
        setErrorMessage(errData.error || 'Gagal mengunggah file rekaman.');
        setUploading(false);
      }
    } catch (err) {
      console.error('Error saving recording:', err);
      setErrorMessage('Terjadi kesalahan koneksi saat mengunggah file rekaman.');
      setUploading(false);
    }
  };

  return (
    <RecordingContext.Provider value={{
      isRecording,
      isPaused,
      meetingId,
      meetingTitle,
      duration,
      uploading,
      errorMessage,
      setErrorMessage,
      devices,
      micId,
      setMicId,
      systemId,
      setSystemId,
      useTabCapture,
      setUseTabCapture,
      micStreamPreview,
      setMicStreamPreview,
      systemStreamPreview,
      setSystemStreamPreview,
      startRecording,
      pauseRecording,
      resumeRecording,
      stopAndSaveRecording,
      activeStreams: activeStreamsRef.current,
      stopPreviews,
      loadDevices,
      isLiveTranscriptEnabled,
      setIsLiveTranscriptEnabled,
      liveEngine,
      setLiveEngine,
      liveTranscriptLang,
      setLiveTranscriptLang,
      liveTranscriptSegments,
      setLiveTranscriptSegments,
      interimText,
      liveTranscriptError,
      isSpeechSupported
    }}>
      {children}
    </RecordingContext.Provider>
  );
}

export function useRecording() {
  return useContext(RecordingContext);
}
