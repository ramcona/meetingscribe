import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ArrowLeft, Clock, Calendar, Users, Mic, Video, Edit2, Check, X, FileText, Sparkles, Copy, RefreshCw, AlertTriangle, Play, Pause, Volume2 } from 'lucide-react';

// Format seconds into MM:SS
function formatDuration(sec) {
  if (!sec || !Number.isFinite(sec) || isNaN(sec) || sec < 0) return '00:00';
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
  const [notes, setNotes] = useState('');
  const [notesSavedState, setNotesSavedState] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const [summaryLanguage, setSummaryLanguage] = useState('id'); // 'id' | 'en' | 'bilingual'
  const saveTimeoutRef = useRef(null);

  // Speakers list states
  const [editingSpeakerList, setEditingSpeakerList] = useState(null);
  const [renameListInput, setRenameListInput] = useState('');

  // Custom audio player states
  const audioRef = useRef(null);
  const transcriptContainerRef = useRef(null);
  const segmentRefs = useRef({});
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);

  // Active segment calculation based on audio current time
  const activeSegmentIdx = useMemo(() => {
    if (!meeting?.segments || meeting.segments.length === 0) return -1;
    return meeting.segments.findIndex((seg, idx) => {
      const nextStart = meeting.segments[idx + 1]?.start_time ?? (seg.end_time || seg.start_time + 10);
      return currentTime >= seg.start_time && currentTime < nextStart;
    });
  }, [currentTime, meeting?.segments]);

  // Smoothly center active segment into focus as audio timeline progresses or seeks
  useEffect(() => {
    if (activeSegmentIdx !== -1 && segmentRefs.current[activeSegmentIdx] && transcriptContainerRef.current) {
      const el = segmentRefs.current[activeSegmentIdx];
      const container = transcriptContainerRef.current;
      const elTop = el.offsetTop - container.offsetTop;
      const targetScrollTop = elTop - (container.clientHeight / 2) + (el.clientHeight / 2);
      container.scrollTo({
        top: Math.max(0, targetScrollTop),
        behavior: 'smooth'
      });
    }
  }, [activeSegmentIdx]);

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
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [meetingId, meeting?.status]);

  const fetchMeetingDetail = async () => {
    try {
      const res = await fetch(`http://localhost:3001/api/meetings/${meetingId}`);
      if (res.ok) {
        const data = await res.json();
        setMeeting(data);
        setNotes(data.notes || '');
      }
    } catch (err) {
      console.error('Error fetching meeting detail:', err);
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

  const handleSaveListRename = async (label) => {
    if (!renameListInput.trim()) return;

    try {
      const res = await fetch(`http://localhost:3001/api/meetings/${meetingId}/speaker`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          speaker_label: label,
          speaker_name: renameListInput.trim()
        })
      });

      if (res.ok) {
        fetchMeetingDetail();
        setEditingSpeakerList(null);
      }
    } catch (err) {
      console.error('Error renaming speaker from list:', err);
    }
  };

  // Custom Audio Player helper methods
  const handleDurationUpdate = () => {
    if (audioRef.current) {
      const dur = audioRef.current.duration;
      if (dur && Number.isFinite(dur) && !isNaN(dur)) {
        setAudioDuration(dur);
      } else if (meeting?.duration_seconds) {
        setAudioDuration(meeting.duration_seconds);
      }
    }
  };

  const onLoadedMetadata = () => {
    if (audioRef.current) {
      const dur = audioRef.current.duration;
      if (dur === Infinity) {
        // Chromium WebM duration workaround
        audioRef.current.currentTime = 1e101;
        audioRef.current.ontimeupdate = function () {
          this.ontimeupdate = null;
          this.currentTime = 0;
          if (Number.isFinite(this.duration)) {
            setAudioDuration(this.duration);
          } else if (meeting?.duration_seconds) {
            setAudioDuration(meeting.duration_seconds);
          }
        };
      } else {
        handleDurationUpdate();
      }
    }
  };

  const onTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch(err => console.error('Audio play error:', err));
    }
  };

  const handleSeek = (e) => {
    const newTime = parseFloat(e.target.value);
    setCurrentTime(newTime);
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
    }
  };

  const handleSegmentClick = (startTime) => {
    if (audioRef.current) {
      audioRef.current.currentTime = startTime;
      audioRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch(err => console.error('Segment jump audio autoplay error:', err));
    }
  };

  const [summaryError, setSummaryError] = useState('');

  const handleGenerateSummary = async (type) => {
    setGeneratingSummary(true);
    setSummaryError('');
    try {
      const res = await fetch(`http://localhost:3001/api/meetings/${meetingId}/summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, language: summaryLanguage })
      });

      if (res.ok) {
        fetchMeetingDetail();
        setSummaryType(type);
      } else {
        const errData = await res.json();
        setSummaryError(errData.error || 'Gagal menyusun ringkasan AI.');
      }
    } catch (err) {
      console.error('Error generating summary:', err);
      setSummaryError('Terjadi kesalahan koneksi saat memproses ringkasan AI.');
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

  const [generatingChapters, setGeneratingChapters] = useState(false);

  const handleGenerateChapters = async () => {
    setGeneratingChapters(true);
    try {
      const res = await fetch(`http://localhost:3001/api/meetings/${meetingId}/chapters`, {
        method: 'POST'
      });
      if (res.ok) {
        fetchMeetingDetail();
      }
    } catch (err) {
      console.error('Error generating chapters:', err);
    } finally {
      setGeneratingChapters(false);
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

  const uniqueSpeakers = [];
  if (meeting?.segments) {
    meeting.segments.forEach(seg => {
      const label = seg.speaker_label;
      const name = seg.speaker_name || label;
      if (!uniqueSpeakers.some(s => s.label === label)) {
        uniqueSpeakers.push({ label, name });
      }
    });
  }

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

        {/* Custom Audio Player */}
        {meeting.audio_path && (() => {
          const displayDuration = (audioDuration && Number.isFinite(audioDuration) && audioDuration > 0)
            ? audioDuration
            : (meeting.duration_seconds && Number.isFinite(meeting.duration_seconds) ? meeting.duration_seconds : 0);

          return (
            <div className="border-t border-white/5 pt-4 flex flex-col gap-3">
              <audio
                ref={audioRef}
                src={`http://localhost:3001/recordings/${meetingId}.webm`}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onLoadedMetadata={onLoadedMetadata}
                onDurationChange={handleDurationUpdate}
                onTimeUpdate={onTimeUpdate}
              />
              
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-black/40 border border-white/5 rounded-2xl p-4">
                {/* Play/Pause & Time */}
                <div className="flex items-center gap-4">
                  <button
                    onClick={togglePlay}
                    className="h-10 w-10 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center transition shadow-lg shadow-indigo-600/10 cursor-pointer shrink-0"
                  >
                    {isPlaying ? <Pause size={16} fill="white" /> : <Play size={16} fill="white" className="translate-x-0.5" />}
                  </button>
                  
                  <div className="space-y-0.5">
                    <div className="text-[10px] font-mono text-gray-500 uppercase tracking-wider">Audio Recording</div>
                    <div className="text-xs font-mono text-white">
                      {formatDuration(currentTime)} <span className="text-gray-600">/</span> {formatDuration(displayDuration)}
                    </div>
                  </div>
                </div>

                {/* Scrubber Bar with Chapter Bookmarks */}
                <div className="flex-1 flex flex-col gap-1">
                  <div className="relative flex items-center">
                    <input
                      type="range"
                      min={0}
                      max={displayDuration || 100}
                      value={currentTime}
                      onChange={handleSeek}
                      className="w-full accent-indigo-500 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer hover:bg-white/20 transition relative z-10"
                      style={{
                        background: `linear-gradient(to right, #6366f1 0%, #6366f1 ${displayDuration > 0 ? Math.min(100, (currentTime / displayDuration) * 100) : 0}%, rgba(255,255,255,0.1) ${displayDuration > 0 ? Math.min(100, (currentTime / displayDuration) * 100) : 0}%, rgba(255,255,255,0.1) 100%)`
                      }}
                    />
                    {/* Chapter Visual Markers on Scrubber */}
                    {displayDuration > 0 && meeting.chapters && meeting.chapters.map((chap, cIdx) => {
                      const posPct = Math.min(99, Math.max(0, (chap.start_time / displayDuration) * 100));
                      return (
                        <div
                          key={cIdx}
                          onClick={() => handleSegmentClick(chap.start_time)}
                          className="absolute h-3 w-1 bg-amber-400 rounded-full hover:scale-150 transition cursor-pointer z-20"
                          style={{ left: `${posPct}%` }}
                          title={`[Chapter ${cIdx + 1}] ${chap.title} (${formatDuration(chap.start_time)})`}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Main Tab Controller */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
        {/* Left Side (Takes 2 columns on wide screens) */}
        <div className="md:col-span-2 space-y-6 flex flex-col animate-fade-in">
          
          {/* Topic Chapters / Bookmarks Card */}
          {meeting.segments && meeting.segments.length > 0 && (
            <div className="bg-[#111113] border border-white/5 rounded-3xl p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
                <div className="flex items-center gap-2">
                  <Sparkles size={16} className="text-amber-400" />
                  <h3 className="text-sm font-semibold text-white">Bab Topik & Visual Bookmarks</h3>
                </div>

                <button
                  onClick={handleGenerateChapters}
                  disabled={generatingChapters}
                  className="text-[10px] font-semibold text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 px-3 py-1.5 rounded-xl transition cursor-pointer flex items-center gap-1 disabled:opacity-50"
                >
                  <RefreshCw size={10} className={generatingChapters ? 'animate-spin' : ''} />
                  {generatingChapters ? 'Menyusun Bab...' : meeting.chapters && meeting.chapters.length > 0 ? 'Regenerate Bab' : 'Buat Bab Topik'}
                </button>
              </div>

              {meeting.chapters && meeting.chapters.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {meeting.chapters.map((chap, cIdx) => (
                    <div
                      key={chap.id || cIdx}
                      onClick={() => handleSegmentClick(chap.start_time)}
                      className="bg-black/40 hover:bg-amber-950/20 border border-white/5 hover:border-amber-500/30 rounded-2xl p-3.5 space-y-1.5 transition cursor-pointer group"
                      title="Klik untuk memutar audio bab ini"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-mono text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full font-semibold">
                          Bab {cIdx + 1} • {formatDuration(chap.start_time)}
                        </span>
                        <Play size={12} className="text-amber-400 opacity-0 group-hover:opacity-100 transition" />
                      </div>
                      <h4 className="text-xs font-bold text-white group-hover:text-amber-300 transition leading-snug">
                        {chap.title}
                      </h4>
                      {chap.summary && (
                        <p className="text-[11px] text-gray-400 leading-normal line-clamp-2">
                          {chap.summary}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-4 text-xs text-gray-500 font-sans">
                  Klik "Buat Bab Topik" di atas untuk membagikan transkrip meeting ini menjadi segmen bab & visual bookmark pada audio scrubber.
                </div>
              )}
            </div>
          )}

          {/* Speakers Directory Card */}
          {meeting.segments && meeting.segments.length > 0 && (
            <div className="bg-[#111113] border border-white/5 rounded-3xl p-6 space-y-4">
              <div className="flex items-center gap-2 border-b border-white/5 pb-2.5">
                <Users size={16} className="text-indigo-400" />
                <h3 className="text-sm font-semibold text-white">Daftar Pembicara (Speakers)</h3>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left text-gray-300">
                  <thead>
                    <tr className="border-b border-white/5 text-[10px] uppercase font-mono tracking-wider text-gray-500">
                      <th className="py-2 px-1">Label Asli</th>
                      <th className="py-2 px-2">Nama Tampilan</th>
                      <th className="py-2 px-2 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {uniqueSpeakers.map((spk) => {
                      const isEditingSpk = editingSpeakerList === spk.label;
                      return (
                        <tr key={spk.label} className="hover:bg-white/5 transition">
                          <td className="py-3 px-1 font-mono text-gray-400">{spk.label}</td>
                          <td className="py-3 px-2 font-semibold text-white">
                            {isEditingSpk ? (
                              <input
                                type="text"
                                value={renameListInput}
                                onChange={(e) => setRenameListInput(e.target.value)}
                                className="bg-black/40 border border-white/10 rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-indigo-500/40 w-full max-w-xs font-sans"
                                autoFocus
                                onKeyDown={(e) => e.key === 'Enter' && handleSaveListRename(spk.label)}
                              />
                            ) : (
                              spk.name
                            )}
                          </td>
                          <td className="py-3 px-2 text-right">
                            {isEditingSpk ? (
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  onClick={() => handleSaveListRename(spk.label)}
                                  className="text-emerald-400 hover:text-emerald-300 font-medium px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/20 cursor-pointer text-[10px]"
                                >
                                  Simpan
                                </button>
                                <button
                                  onClick={() => setEditingSpeakerList(null)}
                                  className="text-gray-400 hover:text-white px-2 py-1 cursor-pointer text-[10px]"
                                >
                                  Batal
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => {
                                  setEditingSpeakerList(spk.label);
                                  setRenameListInput(spk.name);
                                }}
                                className="text-indigo-400 hover:text-indigo-300 font-medium cursor-pointer"
                              >
                                Ubah Nama
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Transcript Card */}
          <div className="bg-[#111113] border border-white/5 rounded-3xl overflow-hidden min-h-[500px] flex flex-col">
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

            <div ref={transcriptContainerRef} className="flex-1 p-6 overflow-y-auto max-h-[600px] space-y-4">
              {meeting.status === 'transcribing' ? (
                <div className="h-64 flex flex-col items-center justify-center text-center p-6 space-y-4">
                  <RefreshCw size={28} className="text-indigo-400 animate-spin" />
                  <div className="space-y-1">
                    <h4 className="text-xs font-medium text-white">Transcribing Audio...</h4>
                    <p className="text-[11px] text-gray-500 leading-relaxed max-w-xs">
                      Gemini API sedang menerjemahkan audio dan memilah pembicara ({meeting.progress || 10}%).
                    </p>
                  </div>
                  
                  <button
                    onClick={handleCancelTranscription}
                    disabled={cancelling}
                    className="bg-red-600/15 hover:bg-red-600/25 border border-red-500/20 hover:border-red-500/30 text-red-400 text-xs font-semibold px-4 py-2 rounded-xl transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {cancelling ? 'Membatalkan...' : 'Batalkan Transkripsi'}
                  </button>
                </div>
              ) : meeting.status === 'failed' ? (
                <div className="h-64 flex flex-col items-center justify-center text-center p-6 space-y-4">
                  <AlertTriangle size={28} className="text-red-400" />
                  <div className="space-y-1.5">
                    <h4 className="text-xs font-semibold text-white">Transcription Job Failed</h4>
                    <p className="text-[11px] text-gray-500 leading-relaxed max-w-xs">
                      Gagal melakukan transkripsi menggunakan model Gemini. Periksa koneksi internet atau validitas API Key Anda di Settings.
                    </p>
                  </div>
                  
                  <button
                    onClick={handleReanalyze}
                    disabled={reanalyzing}
                    className="bg-[#1D1D21] hover:bg-white/5 border border-white/5 hover:border-white/10 text-white text-xs font-semibold px-4 py-2.5 rounded-xl transition cursor-pointer flex items-center gap-1.5"
                  >
                    <RefreshCw size={12} className={reanalyzing ? 'animate-spin' : ''} />
                    {reanalyzing ? 'Memulai Ulang...' : 'Coba Analisis Ulang'}
                  </button>
                </div>
              ) : meeting.status === 'cancelled' ? (
                <div className="h-64 flex flex-col items-center justify-center text-center p-6 space-y-4">
                  <AlertTriangle size={28} className="text-amber-400" />
                  <div className="space-y-1.5">
                    <h4 className="text-xs font-semibold text-white">Transkripsi Dibatalkan</h4>
                    <p className="text-[11px] text-gray-500 leading-relaxed max-w-xs">
                      Proses transkripsi sebelumnya dibatalkan. Rekaman audio Anda tetap tersimpan dan dapat ditranskripsi ulang kapan saja.
                    </p>
                  </div>
                  
                  <button
                    onClick={handleReanalyze}
                    disabled={reanalyzing}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-4 py-2.5 rounded-xl border border-indigo-500/10 transition shadow-lg shadow-indigo-600/10 cursor-pointer flex items-center gap-1.5"
                  >
                    <RefreshCw size={12} className={reanalyzing ? 'animate-spin' : ''} />
                    {reanalyzing ? 'Memulai Transkripsi...' : 'Transkrip Ulang'}
                  </button>
                </div>
              ) : (!meeting.segments || meeting.segments.length === 0) ? (
                meeting.audio_path ? (
                  <div className="h-64 flex flex-col items-center justify-center text-center p-6 space-y-4">
                    <FileText size={28} className="text-indigo-400" />
                    <div className="space-y-1.5">
                      <h4 className="text-xs font-semibold text-white">Belum Ada Transkrip</h4>
                      <p className="text-[11px] text-gray-500 leading-relaxed max-w-xs">
                        File rekaman audio sudah tersimpan. Klik tombol di bawah untuk memulai transkripsi otomatis.
                      </p>
                    </div>
                    
                    <button
                      onClick={handleReanalyze}
                      disabled={reanalyzing}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-4 py-2.5 rounded-xl border border-indigo-500/10 transition shadow-lg shadow-indigo-600/10 cursor-pointer flex items-center gap-1.5"
                    >
                      <RefreshCw size={12} className={reanalyzing ? 'animate-spin' : ''} />
                      {reanalyzing ? 'Memulai Transkripsi...' : 'Mulai Transkripsi'}
                    </button>
                  </div>
                ) : (
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
                )
              ) : (
                <div className="space-y-4">
                  {meeting.segments.map((seg, idx) => {
                    const currentSpeakerName = seg.speaker_name || seg.speaker_label;
                    const isEditing = editingSpeaker === seg.speaker_label;
                    const isActive = idx === activeSegmentIdx;

                    return (
                      <div 
                        key={seg.id || idx} 
                        ref={(el) => (segmentRefs.current[idx] = el)}
                        onClick={() => handleSegmentClick(seg.start_time)}
                        className={`group/segment space-y-1.5 pl-4 py-2.5 rounded-r-2xl pr-3 transition-all duration-200 cursor-pointer ${
                          isActive
                            ? 'border-l-4 border-indigo-500 bg-indigo-950/40 border-y border-r border-indigo-500/20 shadow-lg shadow-indigo-500/10'
                            : 'border-l border-white/10 hover:border-indigo-500/40 hover:bg-white/5'
                        }`}
                        title="Klik untuk memutar audio dari menit ini"
                      >
                        <div className="flex items-center gap-2 text-xs">
                          {isEditing ? (
                            <div 
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center gap-1.5 bg-black/40 border border-white/10 rounded-lg px-2 py-0.5"
                            >
                              <input
                                type="text"
                                value={renameInput}
                                onChange={(e) => setRenameInput(e.target.value)}
                                className="bg-transparent text-white font-semibold focus:outline-none w-28 text-xs font-sans"
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
                            <div className="flex items-center gap-2">
                              {isActive && (
                                <Volume2 size={13} className="text-indigo-400 animate-pulse shrink-0" />
                              )}
                              <span 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleStartRename(seg.speaker_label, seg.speaker_name);
                                }}
                                className={`font-bold transition flex items-center gap-1 group/speaker cursor-pointer ${
                                  isActive ? 'text-indigo-300' : 'text-white hover:text-indigo-400'
                                }`}
                              >
                                {currentSpeakerName}
                                <Edit2 size={10} className="text-gray-500 opacity-0 group-hover/speaker:opacity-100 transition shrink-0" />
                              </span>
                              <span className={`text-[10px] font-mono ${isActive ? 'text-indigo-300/80 font-medium' : 'text-gray-500'}`}>
                                ({formatDuration(seg.start_time)} - {formatDuration(seg.end_time)})
                              </span>
                            </div>
                          )}
                        </div>
                        <p className={`text-xs leading-relaxed font-sans ${isActive ? 'text-white font-medium' : 'text-gray-300'}`}>
                          {seg.text}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
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
            <button
              onClick={() => setSummaryType('notes')}
              className={`flex-1 text-xs font-semibold py-2 rounded-lg transition ${
                summaryType === 'notes' ? 'bg-[#1D1D21] text-white' : 'text-gray-500 hover:text-white'
              }`}
            >
              Notes
            </button>
          </div>

          {/* AI / Notes Panel Body */}
          <div className="flex-1 p-5 flex flex-col justify-between">
            {summaryType === 'notes' ? (
              <div className="flex-1 flex flex-col justify-between gap-4 h-full">
                <div className="flex-1 flex flex-col space-y-2.5 h-full">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-indigo-400 bg-indigo-500/5 px-2.5 py-0.5 rounded-full flex items-center gap-1 border border-indigo-500/10">
                      User Notes
                    </span>
                    
                    {/* Auto-save status */}
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
                        <span className="text-red-400">Gagal menyimpan</span>
                      )}
                      {notesSavedState === 'idle' && notes && (
                        <span className="text-gray-500">Tersimpan</span>
                      )}
                    </div>
                  </div>
                  
                  <textarea
                    value={notes}
                    onChange={handleNotesChange}
                    placeholder="Tulis poin penting, hasil diskusi, keputusan, atau catatan meeting lainnya secara langsung di sini..."
                    className="w-full flex-1 bg-black/20 border border-white/5 focus:border-indigo-500/30 rounded-xl p-4 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:ring-0 resize-none font-sans leading-relaxed min-h-[350px]"
                  />
                </div>
              </div>
            ) : generatingSummary ? (
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

                <div className="border-t border-white/5 pt-4 space-y-3">
                  {/* Language Selector Dropdown */}
                  <div className="w-full space-y-1.5 text-left">
                    <label className="block text-[9px] font-mono uppercase tracking-wider text-gray-500">Bahasa Output AI</label>
                    <select
                      value={summaryLanguage}
                      onChange={(e) => setSummaryLanguage(e.target.value)}
                      className="w-full bg-black/40 border border-white/5 focus:border-indigo-500/30 rounded-xl px-3 py-2 text-xs text-white focus:outline-none transition cursor-pointer"
                    >
                      <option value="id">Bahasa Indonesia</option>
                      <option value="en">English (Inggris)</option>
                      <option value="bilingual">Bilingual (Indonesia & Inggris)</option>
                    </select>
                  </div>

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
                <div className="space-y-1.5 mb-1">
                  <h4 className="text-xs font-semibold text-white">Generate AI Summaries</h4>
                  <p className="text-[11px] text-gray-500 leading-relaxed max-w-[200px]">
                    Dapatkan ringkasan, keputusan utama, dan action items terstruktur secara instan dari transkrip meeting.
                  </p>
                </div>

                {/* Language Selector Dropdown */}
                <div className="w-full space-y-1.5 text-left">
                  <label className="block text-[9px] font-mono uppercase tracking-wider text-gray-500">Bahasa Output AI</label>
                  <select
                    value={summaryLanguage}
                    onChange={(e) => setSummaryLanguage(e.target.value)}
                    className="w-full bg-black/40 border border-white/5 focus:border-indigo-500/30 rounded-xl px-3 py-2 text-xs text-white focus:outline-none transition cursor-pointer"
                  >
                    <option value="id">Bahasa Indonesia</option>
                    <option value="en">English (Inggris)</option>
                    <option value="bilingual">Bilingual (Indonesia & Inggris)</option>
                  </select>
                </div>

                {summaryError && (
                  <div className="w-full p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-xs text-center leading-relaxed">
                    {summaryError}
                  </div>
                )}

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
