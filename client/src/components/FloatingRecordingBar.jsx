import React from 'react';
import { Play, Pause, Square, ExternalLink, Mic } from 'lucide-react';
import { useRecording } from '../context/RecordingContext';

function formatTimer(sec) {
  const hrs = Math.floor(sec / 3600).toString().padStart(2, '0');
  const mins = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
  const secs = Math.floor(sec % 60).toString().padStart(2, '0');
  return hrs !== '00' ? `${hrs}:${mins}:${secs}` : `${mins}:${secs}`;
}

export default function FloatingRecordingBar({ onOpenRecordingPage, onFinishRecording }) {
  const {
    isRecording,
    isPaused,
    meetingTitle,
    duration,
    uploading,
    pauseRecording,
    resumeRecording,
    stopAndSaveRecording
  } = useRecording();

  if (!isRecording && !uploading) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 animate-bounce-in">
      <div className="bg-[#16161A]/95 backdrop-blur-xl border border-red-500/30 shadow-2xl shadow-red-950/40 rounded-2xl p-4 flex items-center gap-5 text-white max-w-lg">
        {/* Pulsing Red Status */}
        <div className="flex items-center gap-3 border-r border-white/10 pr-4">
          <div className="relative flex h-3 w-3">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${isPaused ? 'bg-amber-400' : 'bg-red-400'} opacity-75`}></span>
            <span className={`relative inline-flex rounded-full h-3 w-3 ${isPaused ? 'bg-amber-500' : 'bg-red-500'}`}></span>
          </div>
          <div>
            <div className="text-[10px] font-mono tracking-wider text-red-400 uppercase font-bold flex items-center gap-1">
              <Mic size={10} />
              {uploading ? 'UPLOADING...' : isPaused ? 'PAUSED' : 'LIVE RECORDING'}
            </div>
            <div className="text-sm font-mono font-bold text-white tracking-wide">
              {formatTimer(duration)}
            </div>
          </div>
        </div>

        {/* Meeting Title & Info */}
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-gray-200 truncate max-w-[160px]">
            {meetingTitle || 'Rekaman Meeting'}
          </div>
          <div className="text-[10px] text-gray-400">
            {isPaused ? 'Perekaman dijeda' : 'Sedang merekam suara...'}
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          {/* Pause / Resume */}
          {!uploading && (
            <button
              onClick={isPaused ? resumeRecording : pauseRecording}
              title={isPaused ? 'Lanjutkan Perekaman' : 'Jeda Perekaman'}
              className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition border border-white/10 cursor-pointer"
            >
              {isPaused ? <Play size={14} className="fill-current text-emerald-400" /> : <Pause size={14} className="text-amber-400" />}
            </button>
          )}

          {/* Open Full Record Page */}
          <button
            onClick={onOpenRecordingPage}
            title="Buka Halaman Perekam"
            className="p-2.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 hover:text-indigo-300 transition border border-indigo-500/30 cursor-pointer"
          >
            <ExternalLink size={14} />
          </button>

          {/* Stop & Save */}
          <button
            onClick={() => stopAndSaveRecording(onFinishRecording)}
            disabled={uploading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white font-semibold text-xs shadow-lg shadow-red-600/20 transition disabled:opacity-50 cursor-pointer"
          >
            <Square size={13} className="fill-current" />
            <span>{uploading ? 'Menyimpan...' : 'Hentikan'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
