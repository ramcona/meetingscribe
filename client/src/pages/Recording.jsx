import React, { useState, useEffect, useRef } from 'react';
import { Play, Square, Mic, Video, Settings, ArrowLeft, RefreshCw, AlertTriangle } from 'lucide-react';
import { getAudioInputDevices, startAudioRecording } from '../utils/audioMixer';
import VUMeter from '../components/VUMeter';

export default function Recording({ meetingId, onBack, onRecordingUploaded }) {
  const [meeting, setMeeting] = useState(null);
  const [devices, setDevices] = useState([]);
  
  // Selection states
  const [micId, setMicId] = useState('');
  const [systemId, setSystemId] = useState('');
  const [useTabCapture, setUseTabCapture] = useState(false);
  const [apiKeySet, setApiKeySet] = useState(false);

  // Active streams (for VU meter preview)
  const [micStreamPreview, setMicStreamPreview] = useState(null);
  const [systemStreamPreview, setSystemStreamPreview] = useState(null);

  // Recording running state
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Refs for tracking active recording resources
  const recorderRef = useRef(null);
  const activeStreamsRef = useRef({ mic: null, system: null, mixed: null });
  const audioContextRef = useRef(null);
  const timerRef = useRef(null);
  const chunksRef = useRef([]);

  // Live Meeting Notes states & refs
  const [notes, setNotes] = useState('');
  const [notesSavedState, setNotesSavedState] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const saveTimeoutRef = useRef(null);

  useEffect(() => {
    fetchMeetingDetail();
    loadDevices();
    checkApiKey();

    return () => {
      // Clean up previews and active recordings on unmount
      stopPreviews();
      stopRecordingResources();
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [meetingId]);

  // Handle Global Keyboard Shortcut from Electron main process
  useEffect(() => {
    if (window.electronAPI && window.electronAPI.onGlobalShortcutRecord) {
      const unsubscribe = window.electronAPI.onGlobalShortcutRecord(() => {
        console.log('[Shortcut] Global shortcut triggered!');
        if (isRecording) {
          handleStopRecording();
        } else if (!uploading) {
          handleStartRecording();
        }
      });
      return () => unsubscribe();
    }
  }, [isRecording, uploading, micId, systemId, useTabCapture]);

  // Handle preview stream for mic selection
  useEffect(() => {
    if (isRecording) return; // Don't interrupt recording

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

  const fetchMeetingDetail = async () => {
    try {
      const res = await fetch(`http://localhost:3001/api/meetings/${meetingId}`);
      if (res.ok) {
        const data = await res.json();
        setMeeting(data);
        setNotes(data.notes || '');
        if (data.meeting_type === 'online') {
          // Default to first available or tab capture (disabled in Electron desktop app)
          setUseTabCapture(!window.electronAPI);
        }
      }
    } catch (err) {
      console.error(err);
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

  const loadDevices = async () => {
    const inputDevices = await getAudioInputDevices();
    setDevices(inputDevices);
    if (inputDevices.length > 0) {
      // Set default mic
      const defaultMic = inputDevices.find(d => d.deviceId === 'default') || inputDevices[0];
      setMicId(defaultMic.deviceId);

      // Check if BlackHole is installed and set it as default system input
      const blackhole = inputDevices.find(d => d.label.toLowerCase().includes('blackhole'));
      if (blackhole) {
        setSystemId(blackhole.deviceId);
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
    if (streams.mixed) streams.mixed.getTracks().forEach(t => t.stop());
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    activeStreamsRef.current = { mic: null, system: null, mixed: null };
    recorderRef.current = null;
  };

  const handleStartRecording = async () => {
    setErrorMessage('');
    stopPreviews(); // Turn off previews to avoid resource conflicts

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

      recorderRef.current.onstop = async () => {
        await handleSaveRecording();
      };

      // Start recording (request data slices every 1s)
      recorderRef.current.start(1000);
      setIsRecording(true);
      setDuration(0);

      // Update status to 'recording' and save start timestamp in DB
      try {
        await fetch(`http://localhost:3001/api/meetings/${meetingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'recording',
            recording_started_at: new Date().toISOString()
          })
        });
      } catch (patchErr) {
        console.error('Failed to notify backend that recording started:', patchErr);
      }

      // Start duration timer
      timerRef.current = setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);

    } catch (err) {
      console.error(err);
      setErrorMessage(err.message || 'Gagal memulai perekaman. Pastikan izin microphone dan share-tab telah diberikan.');
      // Restart previews
      loadDevices();
    }
  };

  const handleStopRecording = () => {
    if (recorderRef.current && isRecording) {
      recorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const handleSaveRecording = async () => {
    setUploading(true);
    
    // Compile blobs
    const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
    
    // Clean up streams & audio context
    stopRecordingResources();

    // Prepare upload form data
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');
    formData.append('duration_seconds', duration.toString());
    
    // Auto-calculate exact started_at timestamp
    const startedAt = new Date(Date.now() - duration * 1000).toISOString();
    formData.append('recording_started_at', startedAt);

    try {
      const res = await fetch(`http://localhost:3001/api/meetings/${meetingId}/recording`, {
        method: 'POST',
        body: formData
      });

      if (res.ok) {
        const data = await res.json();
        // Notify parent that upload is complete
        onRecordingUploaded(meetingId);
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

  const formatTimer = (sec) => {
    const hrs = Math.floor(sec / 3600).toString().padStart(2, '0');
    const mins = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
    const secs = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${hrs}:${mins}:${secs}`;
  };

  if (!meeting) return <div className="text-center py-10 font-mono text-gray-500 text-sm">Loading meeting info...</div>;

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-fade-in">
      {/* Navigation */}
      <button
        onClick={onBack}
        disabled={isRecording || uploading}
        className="flex items-center gap-2 text-xs font-medium text-gray-400 hover:text-white transition disabled:opacity-50 cursor-pointer"
      >
        <ArrowLeft size={14} />
        Back to Dashboard
      </button>

      {/* Meeting Header */}
      <div className="bg-[#111113] border border-white/5 rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-indigo-400">
              {meeting.meeting_type === 'online' ? 'Online Capture' : 'Offline Capture'}
            </span>
            {meeting.client && (
              <span className="text-[10px] font-sans text-gray-400 bg-white/5 border border-white/5 px-2 py-0.5 rounded-full">
                {meeting.client}
              </span>
            )}
          </div>
          <h1 className="text-xl font-bold text-white leading-tight">{meeting.title}</h1>
          {meeting.description && <p className="text-xs text-gray-400">{meeting.description}</p>}
        </div>

        {isRecording && (
          <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-2 rounded-xl text-sm font-semibold font-mono animate-pulse">
            <span className="h-2 w-2 rounded-full bg-red-500"></span>
            RECORDING
          </div>
        )}
      </div>

      {/* API Key warning */}
      {!apiKeySet && (
        <div className="bg-yellow-500/5 border border-yellow-500/20 text-yellow-400 rounded-2xl p-4 flex gap-3 text-xs leading-relaxed">
          <AlertTriangle className="shrink-0 text-yellow-500" size={18} />
          <div className="space-y-1">
            <h4 className="font-semibold text-white">Gemini API Key Belum Dikonfigurasi</h4>
            <p>
              Anda tetap dapat merekam, namun transkripsi dan ringkasan akan diproses dalam mode simulasi (mock). Masukkan Gemini API Key Anda di halaman Settings untuk mengaktifkan transkripsi AI asli.
            </p>
          </div>
        </div>
      )}

      {/* Grid Container */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
        
        {/* Left Side: Recorder Board */}
        <div className="lg:col-span-2 bg-[#111113] border border-white/5 rounded-3xl p-6 md:p-8 flex flex-col justify-between min-h-[500px] space-y-8">
          
          {/* Top Panel: Device configurations or Volume Meter */}
          <div className="w-full">
            {/* Device Config Panel (Only visible before recording) */}
            {!isRecording && !uploading && (
              <div className="w-full space-y-4">
                <div className="text-sm font-semibold text-white border-b border-white/5 pb-2">Audio Input Configurations</div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Mic Selector */}
                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-mono uppercase tracking-wider text-gray-500">Your Microphone</label>
                    <select
                      value={micId}
                      onChange={(e) => setMicId(e.target.value)}
                      className="w-full bg-black/40 border border-white/5 focus:border-indigo-500/30 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none transition cursor-pointer"
                    >
                      <option value="">-- No Microphone --</option>
                      {devices.map(d => (
                        <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${d.deviceId.slice(0,5)}`}</option>
                      ))}
                    </select>
                    <VUMeter stream={micStreamPreview} isActive={!!micId} />
                  </div>

                  {/* System Audio Selector (Online only) */}
                  {meeting.meeting_type === 'online' && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="block text-[10px] font-mono uppercase tracking-wider text-gray-500">Participant / System Audio</label>
                        {!window.electronAPI && (
                          <button
                            onClick={() => setUseTabCapture(!useTabCapture)}
                            className={`text-[9px] font-mono px-2 py-0.5 rounded transition ${
                              useTabCapture ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/20' : 'bg-white/5 text-gray-500 border border-transparent'
                            }`}
                          >
                            {useTabCapture ? 'Capture Chrome Tab' : 'Use Virtual Device'}
                          </button>
                        )}
                      </div>
                      
                      {useTabCapture ? (
                        <div className="bg-black/30 border border-white/5 rounded-xl p-3 flex flex-col justify-center min-h-[42px]">
                          <p className="text-[11px] text-gray-400 leading-relaxed">
                            Perekam akan meminta Anda memilih Chrome Tab yang ingin direkam suaranya saat tombol "Start" ditekan. Centang <strong>"Share audio"</strong>.
                          </p>
                        </div>
                      ) : (
                        <>
                          <select
                            value={systemId}
                            onChange={(e) => setSystemId(e.target.value)}
                            className="w-full bg-black/40 border border-white/5 focus:border-indigo-500/30 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none transition cursor-pointer"
                          >
                            <option value="">-- No System Audio --</option>
                            {devices.map(d => (
                              <option key={d.deviceId} value={d.deviceId}>{d.label || `Device ${d.deviceId.slice(0,5)}`}</option>
                            ))}
                          </select>
                          <VUMeter stream={systemStreamPreview} isActive={!!systemId} />
                          {window.electronAPI && (
                            <p className="text-[10px] text-gray-400 mt-1 leading-normal">
                              Di aplikasi desktop, silakan gunakan driver virtual (seperti <strong>BlackHole 2ch</strong>) untuk merekam suara meeting dari Zoom/Chrome/Teams.
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
                
                <div className="flex justify-end pt-2">
                  <button 
                    onClick={loadDevices}
                    className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-white transition"
                  >
                    <RefreshCw size={10} /> Reload devices
                  </button>
                </div>
              </div>
            )}

            {/* Live level meter for active mixed stream during recording */}
            {isRecording && activeStreamsRef.current.mixed && (
              <div className="w-full p-4 bg-black/40 border border-white/5 rounded-2xl space-y-2">
                <div className="text-[10px] font-mono text-center text-gray-500">MIXED RECORDING VOLUME</div>
                <VUMeter stream={activeStreamsRef.current.mixed} isActive={isRecording} />
              </div>
            )}
          </div>

          {/* Middle Panel: Timer & Errors */}
          <div className="w-full flex flex-col items-center space-y-4">
            {/* Timer View */}
            <div className="flex flex-col items-center space-y-2 select-none">
              <div className="text-4xl md:text-5xl font-mono font-bold text-white tracking-widest">
                {formatTimer(duration)}
              </div>
              <div className="text-xs text-gray-500 uppercase tracking-widest font-mono">
                {uploading ? 'UPLOADING REKAMAN...' : isRecording ? 'RECORDING ACTIVE' : 'READY TO RECORD'}
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
          <div className="w-full flex items-center justify-center">
            {uploading ? (
              <div className="h-16 w-16 rounded-full border-t-2 border-indigo-500 animate-spin flex items-center justify-center">
                <span className="text-[9px] font-mono font-bold text-indigo-400">UP</span>
              </div>
            ) : !isRecording ? (
              <button
                onClick={handleStartRecording}
                className="h-20 w-20 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center transition shadow-xl hover:shadow-red-500/10 border border-red-500/20 active:scale-95 group cursor-pointer"
                title="Start Recording"
              >
                <Play size={28} className="text-white fill-white translate-x-0.5 group-hover:scale-110 transition" />
              </button>
            ) : (
              <button
                onClick={handleStopRecording}
                className="h-20 w-20 rounded-full bg-white hover:bg-gray-200 flex items-center justify-center transition shadow-xl border border-white/20 active:scale-95 group cursor-pointer"
                title="Stop Recording"
              >
                <Square size={26} className="text-[#0A0A0B] fill-[#0A0A0B] group-hover:scale-90 transition" />
              </button>
            )}
          </div>
        </div>

        {/* Right Side: Live Notes Panel */}
        <div className="bg-[#111113] border border-white/5 rounded-3xl p-6 flex flex-col justify-between min-h-[500px] space-y-4">
          <div className="space-y-1">
            <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full bg-indigo-500 ${isRecording ? 'animate-pulse' : ''}`}></span>
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
