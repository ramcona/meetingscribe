import React, { useState, useEffect } from 'react';
import { ArrowLeft, Clock, Calendar, Users, Mic, Video, Edit2, Check, X, FileText, Sparkles, Copy, RefreshCw, AlertTriangle } from 'lucide-react';

// Format seconds into MM:SS
function formatDuration(sec) {
  if (!sec) return '00:00';
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// Format SQLite datetime to readable date
function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export default function Detail({ meetingId, onBack, onStartRecording }) {
  const [meeting, setMeeting] = useState(null);
  const [activeTab, setActiveTab] = useState('transcript'); // 'transcript' | 'summary'
  const [summaryType, setSummaryType] = useState('mom'); // 'mom' | 'recap'
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [editingSpeaker, setEditingSpeaker] = useState(null); // { label, value }
  const [renameInput, setRenameInput] = useState('');
  const [copySuccess, setCopySuccess] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    fetchMeetingDetail();
    
    // Set up polling if transcribing
    let pollInterval = null;
    if (meeting && (meeting.status === 'transcribing' || meeting.status === 'recording')) {
      pollInterval = setInterval(() => {
        fetchMeetingDetail();
      }, 3000);
    }

    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [meetingId, meeting?.status]);

  const fetchMeetingDetail = async () => {
    try {
      const res = await fetch(`http://localhost:3001/api/meetings/${meetingId}`);
      if (res.ok) {
        const data = await res.json();
        setMeeting(data);
      }
    } catch (err) {
      console.error('Error fetching meeting detail:', err);
    }
  };

  const handleStartRename = (label, currentName) => {
    setEditingSpeaker(label);
    setRenameInput(currentName || '');
  };

  const handleSaveRename = async (label) => {
    if (!renameInput.trim()) return;

    try {
      const res = await fetch(`http://localhost:3001/api/meetings/${meetingId}/speaker`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          speaker_label: label,
          speaker_name: renameInput.trim()
        })
      });

      if (res.ok) {
        // Refresh local meeting state
        fetchMeetingDetail();
        setEditingSpeaker(null);
      }
    } catch (err) {
      console.error('Error renaming speaker:', err);
    }
  };

  const handleGenerateSummary = async (type) => {
    setGeneratingSummary(true);
    try {
      const res = await fetch(`http://localhost:3001/api/meetings/${meetingId}/summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type })
      });

      if (res.ok) {
        fetchMeetingDetail();
        setSummaryType(type);
      }
    } catch (err) {
      console.error('Error generating summary:', err);
    } finally {
      setGeneratingSummary(false);
    }
  };

  const handleCopySummary = (content) => {
    navigator.clipboard.writeText(content);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  const handleReanalyze = async () => {
    setReanalyzing(true);
    try {
      const res = await fetch(`http://localhost:3001/api/meetings/${meetingId}/reanalyze`, {
        method: 'POST'
      });
      if (res.ok) {
        // Force state status update to start polling
        setMeeting(prev => prev ? { ...prev, status: 'transcribing' } : null);
      }
    } catch (err) {
      console.error('Error starting reanalysis:', err);
    } finally {
      setReanalyzing(false);
    }
  };

  const handleCancelTranscription = async () => {
    if (!window.confirm('Apakah Anda yakin ingin membatalkan proses transkripsi ini? Semua data suara yang direkam akan dihapus.')) return;
    setCancelling(true);
    try {
      const res = await fetch(`http://localhost:3001/api/meetings/${meetingId}/cancel`, {
        method: 'POST'
      });
      if (res.ok) {
        fetchMeetingDetail();
      }
    } catch (err) {
      console.error('Error cancelling transcription:', err);
    } finally {
      setCancelling(false);
    }
  };

  if (!meeting) return <div className="text-center py-10 font-mono text-gray-500 text-sm">Loading details...</div>;

  const currentSummary = meeting.summaries?.find(s => s.type === summaryType);

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      {/* Navigation */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-xs font-medium text-gray-400 hover:text-white transition cursor-pointer"
      >
        <ArrowLeft size={14} />
        Back to Dashboard
      </button>

      {/* Header Panel */}
      <div className="bg-[#111113] border border-white/5 rounded-2xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              {meeting.client && (
                <span className="text-[10px] font-sans text-gray-400 bg-white/5 border border-white/5 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                  <Users size={10} />
                  {meeting.client}
                </span>
              )}
              <span className="text-[10px] font-sans text-gray-400 bg-white/5 border border-white/5 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                {meeting.meeting_type === 'online' ? <Video size={10} className="text-indigo-400" /> : <Mic size={10} className="text-purple-400" />}
                {meeting.meeting_type === 'online' ? 'Online' : 'Offline'}
              </span>
              {meeting.recording_started_at ? (
                <span className="text-[10px] font-mono text-gray-500">
                  Recorded: {formatDate(meeting.recording_started_at)}
                </span>
              ) : (
                <span className="text-[10px] font-mono text-gray-500">
                  Created: {formatDate(meeting.created_at)}
                </span>
              )}
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight leading-snug">{meeting.title}</h1>
            {meeting.description && <p className="text-xs text-gray-400 leading-relaxed max-w-2xl">{meeting.description}</p>}
          </div>

          <div className="shrink-0 flex items-center gap-4">
            <div className="flex items-center gap-1.5 font-mono text-sm text-gray-400">
              <Clock size={14} />
              {formatDuration(meeting.duration_seconds)}
            </div>
          </div>
        </div>

        {/* Audio Player */}
        {meeting.audio_path && (
          <div className="border-t border-white/5 pt-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="text-xs font-mono text-gray-500 uppercase tracking-wider">Audio Recording</div>
            <audio
              src={`http://localhost:3001/recordings/${meetingId}.webm`}
              controls
              className="w-full md:max-w-xl h-9 bg-black/40 border border-white/5 rounded-lg focus:outline-none"
            />
          </div>
        )}
      </div>

      {/* Main Tab Controller */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
        {/* Left Side: Transcript (Takes 2 columns on wide screens) */}
        <div className="md:col-span-2 bg-[#111113] border border-white/5 rounded-3xl overflow-hidden min-h-[500px] flex flex-col">
          <div className="border-b border-white/5 p-4 flex items-center justify-between bg-[#151517]">
            <div className="flex items-center gap-2">
              <FileText size={16} className="text-gray-400" />
              <h2 className="text-sm font-semibold text-white">Transcript</h2>
            </div>
            
            {meeting.status === 'transcribing' && (
              <div className="flex items-center gap-1.5 text-xs text-yellow-400 font-mono">
                <RefreshCw size={12} className="animate-spin" />
                Transcribing ({meeting.progress || 10}%)
              </div>
            )}
          </div>

          {/* Transcript Content */}
          <div className="flex-1 p-6 space-y-6 max-h-[600px] overflow-y-auto">
            {meeting.status === 'transcribing' ? (
              <div className="h-64 flex flex-col items-center justify-center text-center p-6 space-y-4">
                <div className="relative flex items-center justify-center">
                  <div className="h-16 w-16 border-4 border-indigo-500/10 border-t-indigo-500 rounded-full animate-spin"></div>
                  <span className="absolute text-[10px] font-mono font-bold text-indigo-400">{meeting.progress || 10}%</span>
                </div>
                <div className="space-y-1">
                  <h4 className="text-sm font-medium text-white">Transkripsi sedang diproses</h4>
                  <p className="text-xs text-gray-500 max-w-xs leading-relaxed">
                    Gemini API sedang menerjemahkan audio dan memilah pembicara ({meeting.progress || 10}%).
                  </p>
                </div>
                <button
                  disabled={cancelling}
                  onClick={handleCancelTranscription}
                  className="bg-red-500/10 hover:bg-red-500/20 text-red-400 text-[11px] font-semibold px-4 py-2 border border-red-500/20 rounded-xl transition cursor-pointer flex items-center gap-1.5"
                >
                  {cancelling ? 'Membatalkan...' : 'Batalkan Transkripsi'}
                </button>
              </div>
            ) : meeting.status === 'failed' ? (
              <div className="h-64 flex flex-col items-center justify-center text-center p-6 space-y-4 text-red-400">
                <div className="p-3 bg-red-500/5 border border-red-500/10 text-red-400 rounded-2xl">
                  <AlertTriangle size={24} />
                </div>
                <div className="space-y-1">
                  <h4 className="text-sm font-semibold text-white">Gagal memproses transkrip</h4>
                  <p className="text-xs text-gray-500 max-w-xs leading-relaxed">
                    Terjadi kesalahan saat memanggil Gemini API. Cek koneksi internet Anda atau pastikan API Key di Settings sudah benar.
                  </p>
                </div>
                <button
                  disabled={reanalyzing}
                  onClick={handleReanalyze}
                  className="bg-[#1D1D21] hover:bg-white/5 border border-white/5 hover:border-white/10 text-white text-xs font-semibold px-4 py-2.5 rounded-xl transition cursor-pointer flex items-center gap-1.5"
                >
                  <RefreshCw size={12} className={reanalyzing ? 'animate-spin' : ''} />
                  {reanalyzing ? 'Memulai Ulang...' : 'Coba Analisis Ulang'}
                </button>
              </div>
            ) : !meeting.segments || meeting.segments.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-center p-6 space-y-4">
                <div className="p-3 bg-white/5 border border-white/5 text-gray-400 rounded-2xl">
                  <Mic size={24} />
                </div>
                <div className="space-y-1">
                  <h4 className="text-sm font-semibold text-white">Belum ada rekaman suara</h4>
                  <p className="text-xs text-gray-500 max-w-xs leading-relaxed">
                    Meeting ini masih berstatus draft. Mulai rekam suara sekarang untuk mendapatkan transkrip otomatis.
                  </p>
                </div>
                {onStartRecording && (
                  <button
                    onClick={onStartRecording}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-4 py-2.5 rounded-xl border border-indigo-500/10 transition shadow-lg shadow-indigo-600/10 cursor-pointer"
                  >
                    Start Recording
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-6">
                {meeting.segments.map((seg, idx) => {
                  const currentSpeakerName = seg.speaker_name || seg.speaker_label;
                  const isEditing = editingSpeaker === seg.speaker_label;

                  return (
                    <div key={seg.id || idx} className="group/segment space-y-1 border-l border-white/5 pl-4 hover:border-indigo-500/30 transition">
                      <div className="flex items-center gap-2 text-xs">
                        {isEditing ? (
                          <div className="flex items-center gap-1.5 bg-black/40 border border-white/10 rounded-lg px-2 py-0.5">
                            <input
                              type="text"
                              value={renameInput}
                              onChange={(e) => setRenameInput(e.target.value)}
                              className="bg-transparent text-white font-semibold focus:outline-none w-28 text-xs"
                              autoFocus
                              onKeyDown={(e) => e.key === 'Enter' && handleSaveRename(seg.speaker_label)}
                            />
                            <button onClick={() => handleSaveRename(seg.speaker_label)} className="text-emerald-400 hover:text-emerald-300">
                              <Check size={11} />
                            </button>
                            <button onClick={() => setEditingSpeaker(null)} className="text-red-400 hover:text-red-300">
                              <X size={11} />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span 
                              onClick={() => handleStartRename(seg.speaker_label, seg.speaker_name)}
                              className="font-bold text-white hover:text-indigo-400 cursor-pointer transition flex items-center gap-1 group/speaker"
                            >
                              {currentSpeakerName}
                              <Edit2 size={10} className="text-gray-600 opacity-0 group-hover/speaker:opacity-100 transition shrink-0" />
                            </span>
                            <span className="text-[10px] text-gray-500 font-mono">
                              ({formatDuration(seg.start_time)} - {formatDuration(seg.end_time)})
                            </span>
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-gray-300 leading-relaxed">
                        {seg.text}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Side: AI Recap & MoM (Takes 1 column) */}
        <div className="bg-[#111113] border border-white/5 rounded-3xl overflow-hidden min-h-[500px] flex flex-col">
          {/* Tab Selector */}
          <div className="border-b border-white/5 p-2 bg-[#151517] flex gap-1">
            <button
              onClick={() => setSummaryType('mom')}
              className={`flex-1 text-xs font-semibold py-2 rounded-lg transition ${
                summaryType === 'mom' ? 'bg-[#1D1D21] text-white' : 'text-gray-500 hover:text-white'
              }`}
            >
              MoM
            </button>
            <button
              onClick={() => setSummaryType('recap')}
              className={`flex-1 text-xs font-semibold py-2 rounded-lg transition ${
                summaryType === 'recap' ? 'bg-[#1D1D21] text-white' : 'text-gray-500 hover:text-white'
              }`}
            >
              Recap
            </button>
          </div>

          {/* AI Panel Body */}
          <div className="flex-1 p-5 flex flex-col justify-between">
            {generatingSummary ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-4">
                <Sparkles size={28} className="text-indigo-400 animate-pulse" />
                <div className="space-y-1">
                  <h4 className="text-xs font-medium text-white">Menyusun Ringkasan...</h4>
                  <p className="text-[11px] text-gray-500 leading-relaxed max-w-xs">
                    Gemini API sedang menganalisis transkrip meeting Anda untuk menyusun ringkasan terstruktur.
                  </p>
                </div>
              </div>
            ) : currentSummary ? (
              <div className="flex-1 flex flex-col justify-between gap-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-indigo-400 bg-indigo-500/5 px-2 py-0.5 rounded-full flex items-center gap-1 border border-indigo-500/10">
                      <Sparkles size={9} />
                      AI Generated
                    </span>
                    <button
                      onClick={() => handleCopySummary(currentSummary.content)}
                      className="p-1.5 hover:bg-white/5 text-gray-500 hover:text-white border border-transparent hover:border-white/5 rounded-lg transition flex items-center gap-1.5 text-[10px] font-semibold cursor-pointer"
                    >
                      {copySuccess ? 'Copied!' : <><Copy size={11} /> Copy</>}
                    </button>
                  </div>
                  
                  {/* Render Summary content as simplified markdown representation */}
                  <div className="text-xs text-gray-300 leading-relaxed space-y-3 font-sans break-words max-h-[420px] overflow-y-auto pr-1">
                    {(currentSummary.content || '').split('\n').map((line, idx) => {
                      if (line.startsWith('# ')) {
                        return <h2 key={idx} className="text-sm font-bold text-white mt-4 border-b border-white/5 pb-1">{line.replace('# ', '')}</h2>;
                      }
                      if (line.startsWith('## ')) {
                        return <h3 key={idx} className="text-xs font-bold text-white mt-3">{line.replace('## ', '')}</h3>;
                      }
                      if (line.startsWith('- ') || line.startsWith('* ')) {
                        return <li key={idx} className="list-disc list-inside ml-2 pl-1 my-1 text-gray-400">{line.slice(2)}</li>;
                      }
                      if (line.match(/^\d+\.\s/)) {
                        return <div key={idx} className="ml-2 my-1 text-gray-400">{line}</div>;
                      }
                      return <p key={idx} className="my-1 text-gray-300">{line}</p>;
                    })}
                  </div>
                </div>

                <div className="border-t border-white/5 pt-4">
                  <button
                    onClick={() => handleGenerateSummary(summaryType)}
                    className="w-full bg-white/5 hover:bg-white/10 text-white font-medium text-xs rounded-xl py-2.5 border border-white/5 transition flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw size={11} />
                    Regenerate {summaryType === 'mom' ? 'MoM' : 'Recap'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-4">
                <div className="p-3 bg-indigo-500/5 border border-indigo-500/10 text-indigo-400 rounded-2xl">
                  <Sparkles size={20} />
                </div>
                <div className="space-y-1.5">
                  <h4 className="text-xs font-semibold text-white">Generate AI Summaries</h4>
                  <p className="text-[11px] text-gray-500 leading-relaxed max-w-[200px]">
                    Dapatkan ringkasan, keputusan utama, dan action items terstruktur secara instan dari transkrip meeting.
                  </p>
                </div>

                <button
                  disabled={!meeting.segments || meeting.segments.length === 0}
                  onClick={() => handleGenerateSummary(summaryType)}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-xs rounded-xl py-3 border border-indigo-500/10 transition shadow-lg shadow-indigo-600/10 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Sparkles size={12} />
                  Generate {summaryType === 'mom' ? 'Minutes of Meeting' : 'Recap'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
