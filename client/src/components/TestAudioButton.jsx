import React, { useState, useRef, useEffect } from 'react';
import { Play, Square, Loader, CheckCircle, Mic } from 'lucide-react';
import { startAudioRecording } from '../utils/audioMixer';
import VUMeter from './VUMeter';

export default function TestAudioButton({ micId, systemId, useTabCapture, disabled }) {
  const [testState, setTestState] = useState('idle'); // idle, recording, playing
  const [audioUrl, setAudioUrl] = useState(null);
  const [countdown, setCountdown] = useState(5);
  
  const recorderRef = useRef(null);
  const streamsRef = useRef(null);
  const audioPlayerRef = useRef(null);
  const timerRef = useRef(null);
  const chunksRef = useRef([]);

  useEffect(() => {
    return () => cleanup();
  }, []);

  const cleanup = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try { recorderRef.current.stop(); } catch(e){}
    }
    if (streamsRef.current) {
      if (streamsRef.current.micStream) streamsRef.current.micStream.getTracks().forEach(t => t.stop());
      if (streamsRef.current.systemStream) streamsRef.current.systemStream.getTracks().forEach(t => t.stop());
      if (streamsRef.current.mixedStream) {
        streamsRef.current.mixedStream.getTracks().forEach(t => t.stop());
        if (streamsRef.current.mixedStream._dummyAudioElements) {
          streamsRef.current.mixedStream._dummyAudioElements.forEach(el => { el.pause(); el.srcObject = null; });
        }
      }
      if (streamsRef.current.audioContext) streamsRef.current.audioContext.close();
    }
  };

  const handleStartTest = async () => {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
    
    setTestState('recording');
    setCountdown(5);
    chunksRef.current = [];

    try {
      const config = await startAudioRecording({ micDeviceId: micId, systemDeviceId: !useTabCapture ? systemId : null, useTabCapture });
      recorderRef.current = config.recorder;
      streamsRef.current = config;
      
      recorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      
      recorderRef.current.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: config.mimeType || 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        setTestState('playing');
        cleanup();
      };

      recorderRef.current.start(100);

      timerRef.current = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            recorderRef.current.stop();
            clearInterval(timerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

    } catch (err) {
      console.error('Test recording failed:', err);
      setTestState('idle');
      alert('Gagal memulai test rekaman: ' + err.message);
    }
  };

  return (
    <div className="mt-4 p-4 border border-white/10 bg-white/5 rounded-2xl">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-white flex items-center gap-2">
          <Mic className="w-4 h-4 text-indigo-400" />
          Test Audio (5 Detik)
        </h4>
        {testState === 'idle' && (
          <button
            onClick={handleStartTest}
            disabled={disabled}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-medium text-white rounded-lg transition"
          >
            Mulai Test
          </button>
        )}
        {testState === 'recording' && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-rose-500/20 text-rose-400 text-xs font-medium rounded-lg">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
            Merekam {countdown}s
          </div>
        )}
        {testState === 'playing' && (
          <button
            onClick={() => setTestState('idle')}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-xs font-medium text-white rounded-lg transition"
          >
            Selesai
          </button>
        )}
      </div>

      {testState === 'recording' && streamsRef.current && (
        <div className="mt-3">
          <VUMeter stream={streamsRef.current.mixedStream} isActive={true} />
        </div>
      )}

      {testState === 'playing' && audioUrl && (
        <div className="mt-3 bg-black/40 p-3 rounded-xl border border-white/5 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs text-emerald-400 font-medium">
            <CheckCircle className="w-4 h-4" /> Rekaman Test Selesai
          </div>
          <audio 
            ref={audioPlayerRef} 
            src={audioUrl} 
            controls 
            autoPlay 
            className="w-full h-8 outline-none"
          />
        </div>
      )}
    </div>
  );
}
