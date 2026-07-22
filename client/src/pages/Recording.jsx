import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, Pause, Square, Mic, Video, Settings, ArrowLeft, RefreshCw, 
  AlertTriangle, Sparkles, Radio, Globe, Copy, Trash2, Check, Volume2, MessageSquare
} from 'lucide-react';
import { useRecording } from '../context/RecordingContext';
import VUMeter from '../components/VUMeter';
import WhisperSetupModal from '../components/WhisperSetupModal';

export default function Recording({ meetingId, onBack, onRecordingUploaded }) {
  const [meeting, setMeeting] = useState(null);
  const [apiKeySet, setApiKeySet] = useState(false);

  const {
    isRecording,
    isPaused,
    meetingId: activeRecordingMeetingId,
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
    activeStreams,
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
  } = useRecording();

  // Live Meeting Notes states & refs
  const [notes, setNotes] = useState('');
  const [notesSavedState, setNotesSavedState] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const saveTimeoutRef = useRef(null);
  const transcriptEndRef = useRef(null);
  const [copiedTranscript, setCopiedTranscript] = useState(false);
  const [whisperEngineStatus, setWhisperEngineStatus] = useState(null);
  const [showWhisperSetup, setShowWhisperSetup] = useState(false);

  const isCurrentMeetingRecording = isRecording && activeRecordingMeetingId === meetingId;

  const refreshEngineStatus = () => {
    fetch('http://localhost:3001/api/whisper-engine-status')
      .then(r => r.json())
      .then(setWhisperEngineStatus)
      .catch(() => setWhisperEngineStatus({ engine: 'onnx', ready: false }));
  };

  // When user toggles Live Transcript ON with whisper engine, check if setup is done
  const handleToggleLiveTranscript = (checked) => {
    if (checked && liveEngine === 'whisper' && whisperEngineStatus && !whisperEngineStatus.ready) {
      setShowWhisperSetup(true);
      return;
    }
    setIsLiveTranscriptEnabled(checked);
  };

  useEffect(() => {
    if (meetingId) {
      fetchMeetingDetail(meetingId);
    } else {
      createAutoMeeting();
    }
    checkApiKey();

    // Check which Whisper engine is active (whisper.cpp vs ONNX)
    refreshEngineStatus();

    return () => {
      stopPreviews();
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [meetingId]);

  // Auto-scroll Live Transcript box as new speech streams in
  useEffect(() => {
    if (transcriptEndRef.current && isLiveTranscriptEnabled) {
      transcriptEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [liveTranscriptSegments, interimText, isLiveTranscriptEnabled]);

  // Handle preview stream for mic selection
  useEffect(() => {
    if (isRecording) return;

    const setupMicPreview = async () => {
      if (micStreamPreview) {
        micStreamPreview.getTracks().forEach(t => t.stop());
        setMicStreamPreview(null);
      }
      if (!micId) return;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: micId } }
        });
        setMicStreamPreview(stream);
      } catch (err) {
        console.error('Error starting mic preview:', err);
      }
    };

    setupMicPreview();
  }, [micId, isRecording]);

  // Handle preview stream for system audio selection
  useEffect(() => {
    if (isRecording) return;

    const setupSystemPreview = async () => {
      if (systemStreamPreview) {
        systemStreamPreview.getTracks().forEach(t => t.stop());
        setSystemStreamPreview(null);
      }
      if (!systemId || useTabCapture) return;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: systemId } }
        });
        setSystemStreamPreview(stream);
      } catch (err) {
        console.error('Error starting system audio preview:', err);
      }
    };

    setupSystemPreview();
  }, [systemId, useTabCapture, isRecording]);

  const checkApiKey = async () => {
    try {
      const res = await fetch('http://localhost:3001/api/settings');
      if (res.ok) {
        const data = await res.json();
        setApiKeySet(data.gemini_api_key_set);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const createAutoMeeting = async () => {
    try {
      const now = new Date();
      const dateStr = now.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      const res = await fetch('http://localhost:3001/api/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Meeting ${dateStr}`,
          meeting_type: 'offline'
        })
      });
      if (res.ok) {
        const data = await res.json();
        fetchMeetingDetail(data.id);
      }
    } catch (err) {
      console.error('Error auto creating draft meeting:', err);
      setMeeting({
        id: 'temp-' + Date.now(),
        title: 'Meeting Recording',
        meeting_type: 'offline',
        status: 'draft'
      });
    }
  };

  const fetchMeetingDetail = async (targetId = meetingId) => {
    if (!targetId) return;
    try {
      const res = await fetch(`http://localhost:3001/api/meetings/${targetId}`);
      if (res.ok) {
        const data = await res.json();
        setMeeting(data);
        setNotes(data.notes || '');
        if (data.meeting_type === 'online') {
          setUseTabCapture(!window.electronAPI);
        }
      } else {
        setMeeting({
          id: targetId,
          title: 'Meeting Recording',
          meeting_type: 'offline',
          status: 'draft'
        });
      }
    } catch (err) {
      console.error(err);
      setMeeting({
        id: targetId || 'temp',
        title: 'Meeting Recording',
        meeting_type: 'offline',
        status: 'draft'
      });
    }
  };

  const saveNotes = async (updatedNotes) => {
    try {
      setNotesSavedState('saving');
      const res = await fetch(`http://localhost:3001/api/meetings/${meetingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: updatedNotes })
      });
      if (res.ok) {
        setNotesSavedState('saved');
      } else {
        setNotesSavedState('error');
      }
    } catch (err) {
      console.error('Error saving notes:', err);
      setNotesSavedState('error');
    }
  };

  const handleNotesChange = (e) => {
    const val = e.target.value;
    setNotes(val);
    setNotesSavedState('saving');

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      saveNotes(val);
    }, 1000);
  };

  const handleAppendLiveTranscriptToNotes = () => {
    if (liveTranscriptSegments.length === 0) return;
    const textToAppend = liveTranscriptSegments.map(s => `[${formatTimer(s.timestamp)}] ${s.text}`).join('\n');
    const updated = notes ? `${notes}\n\n--- Live Transcript (Beta) ---\n${textToAppend}` : `--- Live Transcript (Beta) ---\n${textToAppend}`;
    setNotes(updated);
    saveNotes(updated);
    setCopiedTranscript(true);
    setTimeout(() => setCopiedTranscript(false), 2000);
  };

  const formatTimer = (sec) => {
    const hrs = Math.floor(sec / 3600).toString().padStart(2, '0');
    const mins = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
    const secs = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${hrs}:${mins}:${secs}`;
  };

  if (!meeting) return <div className="text-center py-10 font-mono text-gray-500 text-sm">Loading meeting info...</div>;

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-fade-in pb-12">
      {/* whisper.cpp On-Demand Setup Modal */}
      {showWhisperSetup && (
        <WhisperSetupModal
          onClose={() => setShowWhisperSetup(false)}
          onDone={() => {
            setShowWhisperSetup(false);
            refreshEngineStatus();
            setIsLiveTranscriptEnabled(true);
          }}
          onFallbackOnnx={() => {
            setShowWhisperSetup(false);
            setIsLiveTranscriptEnabled(true);
          }}
        />
      )}
      {/* Navigation */}
      <button
        onClick={onBack}
        disabled={uploading}
        className="flex items-center gap-2 text-xs font-medium text-gray-400 hover:text-white transition disabled:opacity-50 cursor-pointer"
      >
        <ArrowLeft size={14} />
        Back to Dashboard
      </button>

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-indigo-400 uppercase tracking-widest font-semibold">
              {meeting.meeting_type === 'online' ? 'Online Meeting' : 'Offline Meeting'}
            </span>
            {meeting.client && (
              <span className="text-xs px-2 py-0.5 rounded bg-white/5 text-gray-400 border border-white/5">
                {meeting.client}
              </span>
            )}
          </div>
          <h1 className="text-2xl font-bold text-white mt-1">{meeting.title}</h1>
        </div>

        {!apiKeySet && (
          <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-xl text-xs">
            <AlertTriangle size={14} className="shrink-0" />
            <span>Gemini API Key belum diatur. Menggunakan transkripsi lokal.</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Side: Recording Control Panel & Live Transcript */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-[#111113] border border-white/5 rounded-3xl p-8 flex flex-col justify-between items-center space-y-8">
            
            {/* Audio Inputs Selector */}
            <div className="w-full space-y-4">
              <h3 className="text-xs font-mono font-semibold text-gray-400 uppercase tracking-wider">Sumber Audio</h3>

              {/* Microphone Selector */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-300 flex items-center justify-between">
                  <span>Microphone Suara Anda</span>
                  <span className="text-[10px] text-gray-500">Audio Input</span>
                </label>
                <select
                  value={micId}
                  onChange={(e) => setMicId(e.target.value)}
                  disabled={isRecording || uploading}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-indigo-500/50 disabled:opacity-50 cursor-pointer"
                >
                  {devices.map(d => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone (${d.deviceId.slice(0, 5)})`}</option>
                  ))}
                </select>
                {micStreamPreview && !isRecording && (
                  <div className="pt-1">
                    <div className="text-[10px] font-mono text-gray-500 mb-1">MIC PREVIEW LEVEL</div>
                    <VUMeter stream={micStreamPreview} isActive={true} />
                  </div>
                )}
              </div>

              {/* System Audio Selector */}
              <div className="space-y-2 pt-2">
                <label className="text-xs font-medium text-gray-300 flex items-center justify-between">
                  <span>Audio System / Lawan Bicara (Zoom/Meet/Teams)</span>
                  <span className="text-[10px] text-gray-500">System Loopback</span>
                </label>

                {window.electronAPI ? (
                  <select
                    value={systemId}
                    onChange={(e) => setSystemId(e.target.value)}
                    disabled={isRecording || uploading}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-indigo-500/50 disabled:opacity-50 cursor-pointer"
                  >
                    <option value="">-- Tanpa System Audio (Microphone Saja) --</option>
                    {devices.map(d => (
                      <option key={d.deviceId} value={d.deviceId}>{d.label || `Device (${d.deviceId.slice(0, 5)})`}</option>
                    ))}
                  </select>
                ) : (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setUseTabCapture(false)}
                        disabled={isRecording || uploading}
                        className={`flex-1 py-2 px-3 rounded-xl border text-xs font-medium transition cursor-pointer ${
                          !useTabCapture ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/40' : 'bg-black/20 text-gray-400 border-white/5'
                        }`}
                      >
                        BlackHole / Audio Output
                      </button>
                      <button
                        type="button"
                        onClick={() => setUseTabCapture(true)}
                        disabled={isRecording || uploading}
                        className={`flex-1 py-2 px-3 rounded-xl border text-xs font-medium transition cursor-pointer ${
                          useTabCapture ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/40' : 'bg-black/20 text-gray-400 border-white/5'
                        }`}
                      >
                        Share Tab Audio
                      </button>
                    </div>

                    {!useTabCapture && (
                      <select
                        value={systemId}
                        onChange={(e) => setSystemId(e.target.value)}
                        disabled={isRecording || uploading}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-indigo-500/50 disabled:opacity-50 cursor-pointer"
                      >
                        <option value="">-- Tanpa System Audio --</option>
                        {devices.map(d => (
                          <option key={d.deviceId} value={d.deviceId}>{d.label || `Device (${d.deviceId.slice(0, 5)})`}</option>
                        ))}
                      </select>
                    )}
                  </div>
                )}

                {systemStreamPreview && !useTabCapture && !isRecording && (
                  <div className="pt-1">
                    <div className="text-[10px] font-mono text-gray-500 mb-1">SYSTEM AUDIO PREVIEW LEVEL</div>
                    <VUMeter stream={systemStreamPreview} isActive={true} />
                  </div>
                )}
              </div>

              {devices.length === 0 && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-xl text-xs space-y-2">
                  <div>Tidak ada microphone terdeteksi. Silakan hubungkan microphone dan klik reload.</div>
                  <button
                    type="button"
                    onClick={loadDevices}
                    className="flex items-center gap-1 text-[10px] text-white underline"
                  >
                    <RefreshCw size={10} /> Reload devices
                  </button>
                </div>
              )}

              {/* Live level meter for active mixed stream during recording */}
              {isCurrentMeetingRecording && activeStreams?.mixed && (
                <div className="w-full p-4 bg-black/40 border border-white/5 rounded-2xl space-y-2">
                  <div className="text-[10px] font-mono text-center text-gray-500">MIXED RECORDING VOLUME</div>
                  <VUMeter stream={activeStreams.mixed} isActive={isRecording} />
                </div>
              )}
            </div>

            {/* Middle Panel: Timer & Errors */}
            <div className="w-full flex flex-col items-center space-y-4">
              {/* Timer View */}
              <div className="flex flex-col items-center space-y-2 select-none">
                <div className="text-4xl md:text-5xl font-mono font-bold text-white tracking-widest">
                  {formatTimer(isCurrentMeetingRecording ? duration : 0)}
                </div>
                <div className="text-xs text-gray-500 uppercase tracking-widest font-mono">
                  {uploading ? 'UPLOADING REKAMAN...' : isCurrentMeetingRecording ? (isPaused ? 'RECORDING PAUSED' : 'RECORDING ACTIVE') : 'READY TO RECORD'}
                </div>
              </div>

              {/* Errors display */}
              {errorMessage && (
                <div className="w-full p-4 bg-red-500/5 border border-red-500/20 text-red-400 rounded-2xl text-xs text-center leading-relaxed animate-pulse">
                  {errorMessage}
                </div>
              )}
            </div>

            {/* Bottom Panel: Action Buttons */}
            <div className="w-full flex items-center justify-center gap-4">
              {uploading ? (
                <div className="h-16 w-16 rounded-full border-t-2 border-indigo-500 animate-spin flex items-center justify-center">
                  <span className="text-[9px] font-mono font-bold text-indigo-400">UP</span>
                </div>
              ) : !isCurrentMeetingRecording ? (
                <button
                  onClick={() => startRecording(meetingId || meeting.id, meeting?.title || 'Rekaman Meeting')}
                  className="h-20 w-20 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center transition shadow-xl hover:shadow-red-500/10 border border-red-500/20 active:scale-95 group cursor-pointer"
                  title="Start Recording"
                >
                  <Play size={28} className="text-white fill-white translate-x-0.5 group-hover:scale-110 transition" />
                </button>
              ) : (
                <div className="flex items-center gap-4">
                  <button
                    onClick={isPaused ? resumeRecording : pauseRecording}
                    className="h-14 w-14 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition border border-white/10 active:scale-95 cursor-pointer"
                    title={isPaused ? 'Resume' : 'Pause'}
                  >
                    {isPaused ? <Play size={20} className="fill-current text-emerald-400" /> : <Pause size={20} className="text-amber-400" />}
                  </button>
                  <button
                    onClick={() => stopAndSaveRecording(onRecordingUploaded)}
                    className="h-20 w-20 rounded-full bg-white hover:bg-gray-200 flex items-center justify-center transition shadow-xl border border-white/20 active:scale-95 group cursor-pointer"
                    title="Stop & Save Recording"
                  >
                    <Square size={26} className="text-[#0A0A0B] fill-[#0A0A0B] group-hover:scale-90 transition" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* NEW: Live Transcript (Beta) Real-Time Panel */}
          <div className="bg-[#111113] border border-white/5 rounded-3xl p-6 space-y-4 shadow-xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-xl">
                  <Radio size={18} className={isCurrentMeetingRecording && isLiveTranscriptEnabled && !isPaused ? 'animate-pulse text-indigo-400' : ''} />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold text-white">Live Transcript Stream</h3>
                    <span className="px-2 py-0.5 bg-indigo-500/15 text-indigo-400 font-mono text-[10px] font-bold rounded-full border border-indigo-500/30">
                      BETA
                    </span>
                    {whisperEngineStatus && liveEngine === 'whisper' && (
                      <span className={`px-2 py-0.5 font-mono text-[10px] font-bold rounded-full border ${
                        whisperEngineStatus.engine === 'whisper.cpp'
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                          : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                      }`}>
                        {whisperEngineStatus.engine === 'whisper.cpp' ? '⚡ whisper.cpp Metal GPU' : '🔁 ONNX Fallback'}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-400">
                    {liveEngine === 'whisper'
                      ? (whisperEngineStatus?.engine === 'whisper.cpp'
                          ? 'Menggunakan whisper.cpp C++ native dengan akselerasi Metal GPU Apple Silicon'
                          : 'Menggunakan ONNX Transformers.js (whisper.cpp belum terinstall)')
                      : 'Transkripsi real-time via Web Speech API Browser'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {/* Engine Picker */}
                <select
                  value={liveEngine}
                  onChange={(e) => setLiveEngine(e.target.value)}
                  className="bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none cursor-pointer"
                  title="Pilih Engine Real-Time Live Transcript"
                >
                  <option value="whisper">🔒 Local Whisper (100% Offline)</option>
                  <option value="webspeech">🌐 Web Speech API (Browser)</option>
                </select>

                {/* Language Picker for Web Speech */}
                {liveEngine === 'webspeech' && (
                  <select
                    value={liveTranscriptLang}
                    onChange={(e) => setLiveTranscriptLang(e.target.value)}
                    className="bg-black/40 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none cursor-pointer"
                  >
                    <option value="id-ID">🇮🇩 Indonesia</option>
                    <option value="en-US">🇺🇸 English</option>
                  </select>
                )}

                {/* Live Transcript Toggle Switch */}
                <label className="relative inline-flex items-center cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={isLiveTranscriptEnabled}
                    onChange={(e) => handleToggleLiveTranscript(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                </label>
              </div>
            </div>

            {/* Error or Browser Support Warning */}
            {liveTranscriptError && isLiveTranscriptEnabled && (
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-xl text-xs flex items-center gap-2">
                <AlertTriangle size={14} className="shrink-0" />
                <span>{liveTranscriptError}</span>
              </div>
            )}

            {/* Real-Time Live Transcript Stream Box */}
            <div className="bg-[#070709] border border-white/5 rounded-2xl p-4 min-h-[160px] max-h-64 overflow-y-auto space-y-3 font-sans text-xs">
              {!isLiveTranscriptEnabled ? (
                <div className="text-center py-10 text-gray-500 text-xs italic space-y-1">
                  <div>Live Transcript (Beta) sedang dinonaktifkan.</div>
                  <div className="text-[11px] text-gray-600">Aktifkan saklar di kanan atas untuk melihat percakapan suara secara langsung saat merekam.</div>
                </div>
              ) : liveTranscriptSegments.length === 0 && !interimText ? (
                <div className="text-center py-10 text-gray-500 text-xs italic space-y-2">
                  {isCurrentMeetingRecording && !isPaused ? (
                    <div className="flex items-center justify-center gap-2 text-indigo-400 animate-pulse">
                      <span className="h-2 w-2 rounded-full bg-indigo-500"></span>
                      <span>Mendengarkan percakapan... Silakan bicara pada mikrofon</span>
                    </div>
                  ) : (
                    <div>Klik tombol <strong>Start Record (Play)</strong> di atas untuk memulai streaming live transkrip.</div>
                  )}
                </div>
              ) : (
                <>
                  {liveTranscriptSegments.map((seg) => (
                    <div key={seg.id} className="flex items-start gap-2.5 group">
                      <span className="text-[10px] font-mono text-gray-500 shrink-0 mt-0.5">
                        [{formatTimer(seg.timestamp)}]
                      </span>
                      <span className="text-gray-200 leading-relaxed font-normal">
                        {seg.text}
                      </span>
                    </div>
                  ))}

                  {/* Real-time Interim Streaming Text */}
                  {interimText && (
                    <div className="flex items-start gap-2.5 text-indigo-300 italic animate-pulse">
                      <span className="text-[10px] font-mono text-indigo-400 shrink-0 mt-0.5">
                        [{formatTimer(duration)}]
                      </span>
                      <span className="leading-relaxed">
                        {interimText}...
                      </span>
                    </div>
                  )}
                  <div ref={transcriptEndRef} />
                </>
              )}
            </div>

            {/* Footer Toolbar for Live Transcript */}
            {isLiveTranscriptEnabled && liveTranscriptSegments.length > 0 && (
              <div className="flex items-center justify-between pt-1 text-xs">
                <span className="text-[11px] text-gray-400 font-mono">
                  {liveTranscriptSegments.length} frasa terdeteksi secara langsung
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleAppendLiveTranscriptToNotes}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 border border-indigo-500/20 rounded-xl text-xs font-medium transition cursor-pointer"
                  >
                    {copiedTranscript ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                    {copiedTranscript ? 'Disalin ke Catatan!' : 'Salin ke Meeting Notes'}
                  </button>
                  <button
                    onClick={() => setLiveTranscriptSegments([])}
                    className="p-1.5 hover:bg-white/5 text-gray-500 hover:text-red-400 rounded-lg transition cursor-pointer"
                    title="Clear Live Transcript Feed"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Live Notes Panel */}
        <div className="bg-[#111113] border border-white/5 rounded-3xl p-6 flex flex-col justify-between min-h-[500px] space-y-4">
          <div className="space-y-1">
            <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full bg-indigo-500 ${isCurrentMeetingRecording ? 'animate-pulse' : ''}`}></span>
                <h3 className="text-sm font-semibold text-white">Live Meeting Notes</h3>
              </div>
              
              {/* Save Status Indicators */}
              <div className="flex items-center gap-1.5 text-[10px] font-mono">
                {notesSavedState === 'saving' && (
                  <span className="text-yellow-400 flex items-center gap-1">
                    <RefreshCw size={10} className="animate-spin" />
                    Menyimpan...
                  </span>
                )}
                {notesSavedState === 'saved' && (
                  <span className="text-green-400 flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-400"></span>
                    Tersimpan otomatis
                  </span>
                )}
                {notesSavedState === 'error' && (
                  <span className="text-red-400 flex items-center gap-1">
                    Gagal menyimpan
                  </span>
                )}
                {notesSavedState === 'idle' && notes && (
                  <span className="text-gray-500">Tersimpan</span>
                )}
              </div>
            </div>
          </div>

          <textarea
            value={notes}
            onChange={handleNotesChange}
            placeholder="Tulis poin penting, agenda, keputusan, atau catatan meeting lainnya secara langsung di sini..."
            className="w-full flex-1 bg-black/30 border border-white/5 focus:border-indigo-500/30 rounded-xl p-4 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:ring-0 resize-none font-sans leading-relaxed"
          />

          <div className="text-[10px] text-gray-500 leading-normal">
            Catatan meeting tersimpan otomatis secara lokal dan dapat Anda baca kembali di halaman detail meeting.
          </div>
        </div>

      </div>
    </div>
  );
}
