import React, { useState, useEffect } from 'react';
import { Search, Plus, Calendar, Clock, Video, Mic, Trash2, ChevronRight, Users, Play } from 'lucide-react';

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

export default function Dashboard({ onSelectMeeting, onCreateNew }) {
  const [meetings, setMeetings] = useState([]);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // Form states
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [client, setClient] = useState('');
  const [meetingType, setMeetingType] = useState('offline');

  const [searchResults, setSearchResults] = useState(null);

  useEffect(() => {
    fetchMeetings();
  }, []);

  useEffect(() => {
    if (!search.trim()) {
      setSearchResults(null);
      return;
    }

    const timer = setTimeout(() => {
      fetchSearchResults(search.trim());
    }, 300);

    return () => clearTimeout(timer);
  }, [search]);

  const fetchMeetings = async () => {
    try {
      const res = await fetch('http://localhost:3001/api/meetings');
      if (res.ok) {
        const data = await res.json();
        setMeetings(data);
      }
    } catch (err) {
      console.error('Error fetching meetings:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchSearchResults = async (query) => {
    try {
      setLoading(true);
      const res = await fetch(`http://localhost:3001/api/search?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data);
      }
    } catch (err) {
      console.error('Error performing search:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateMeeting = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;

    try {
      const res = await fetch('http://localhost:3001/api/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description,
          client,
          meeting_type: meetingType
        })
      });

      if (res.ok) {
        const data = await res.json();
        setIsModalOpen(false);
        // Clear form
        setTitle('');
        setDescription('');
        setClient('');
        setMeetingType('offline');
        
        // Trigger page transition to recording page directly
        onCreateNew(data.id);
      }
    } catch (err) {
      console.error('Error creating meeting:', err);
    }
  };

  const handleDelete = async (e, id) => {
    e.stopPropagation(); // Avoid triggering open meeting
    if (!confirm('Apakah Anda yakin ingin menghapus riwayat meeting ini? Semua file rekaman, transkrip, dan ringkasan akan dihapus permanen.')) {
      return;
    }

    try {
      const res = await fetch(`http://localhost:3001/api/meetings/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setMeetings(meetings.filter(m => m.id !== id));
      }
    } catch (err) {
      console.error('Error deleting meeting:', err);
    }
  };

  const displayMeetings = (searchResults !== null ? searchResults : meetings).filter(m => {
    if (filterType === 'all') return true;
    return m.meeting_type === filterType;
  });

  const getStatusBadge = (status) => {
    switch (status) {
      case 'recording':
        return (
          <span className="flex items-center gap-1 text-[11px] font-medium text-red-400 bg-red-500/5 border border-red-500/10 px-2 py-0.5 rounded-full">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse"></span>
            Recording
          </span>
        );
      case 'transcribing':
        return (
          <span className="flex items-center gap-1 text-[11px] font-medium text-yellow-400 bg-yellow-500/5 border border-yellow-500/10 px-2 py-0.5 rounded-full">
            <span className="h-1.5 w-1.5 rounded-full bg-yellow-400 animate-ping"></span>
            Transcribing
          </span>
        );
      case 'done':
        return (
          <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-400 bg-emerald-500/5 border border-emerald-500/10 px-2 py-0.5 rounded-full">
            Done
          </span>
        );
      case 'failed':
        return (
          <span className="flex items-center gap-1 text-[11px] font-medium text-red-500 bg-red-950/20 border border-red-900/30 px-2 py-0.5 rounded-full">
            Failed
          </span>
        );
      case 'cancelled':
        return (
          <span className="flex items-center gap-1 text-[11px] font-medium text-amber-400 bg-amber-500/5 border border-amber-500/10 px-2 py-0.5 rounded-full">
            Cancelled
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 text-[11px] font-medium text-gray-400 bg-white/5 border border-white/5 px-2 py-0.5 rounded-full">
            Draft
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header and Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Meeting History</h1>
          <p className="text-sm text-gray-400">Manage, record, search, and summarize your meetings</p>
        </div>

        <button
          onClick={() => setIsModalOpen(true)}
          className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2.5 rounded-xl flex items-center justify-center gap-2 transition shadow-lg shadow-indigo-600/15 border border-indigo-500/10 cursor-pointer"
        >
          <Plus size={16} />
          New Meeting
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-[#111113] border border-white/5 rounded-2xl p-4 flex flex-col sm:flex-row items-center gap-4">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-3 text-gray-500" size={16} />
          <input
            type="text"
            placeholder="Pencarian global: cari judul, klien, isi transkrip, catatan, atau ringkasan AI..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-black/40 border border-white/5 focus:border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none transition"
          />
        </div>

        <div className="flex bg-black/40 p-1 border border-white/5 rounded-xl shrink-0 w-full sm:w-auto">
          <button
            onClick={() => setFilterType('all')}
            className={`flex-1 sm:flex-none text-xs font-medium px-3.5 py-1.5 rounded-lg transition ${
              filterType === 'all' ? 'bg-[#1D1D21] text-white shadow' : 'text-gray-500 hover:text-white'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilterType('online')}
            className={`flex-1 sm:flex-none text-xs font-medium px-3.5 py-1.5 rounded-lg transition ${
              filterType === 'online' ? 'bg-[#1D1D21] text-white shadow' : 'text-gray-500 hover:text-white'
            }`}
          >
            Online
          </button>
          <button
            onClick={() => setFilterType('offline')}
            className={`flex-1 sm:flex-none text-xs font-medium px-3.5 py-1.5 rounded-lg transition ${
              filterType === 'offline' ? 'bg-[#1D1D21] text-white shadow' : 'text-gray-500 hover:text-white'
            }`}
          >
            Offline
          </button>
        </div>
      </div>

      {/* Meetings Grid/List */}
      {loading ? (
        <div className="h-64 flex items-center justify-center text-sm text-gray-500 font-mono">
          Searching history...
        </div>
      ) : displayMeetings.length === 0 ? (
        <div className="border border-dashed border-white/5 rounded-3xl h-64 flex flex-col items-center justify-center text-center p-6 space-y-3 bg-[#111113]/20">
          <div className="p-3 bg-white/5 border border-white/5 text-gray-400 rounded-2xl">
            <Calendar size={24} />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-white">No meetings found</h3>
            <p className="text-xs text-gray-500 max-w-xs">
              {search ? 'Tidak ada hasil transkrip atau meeting yang cocok dengan kata kunci pencarian Anda.' : 'Buat draft meeting baru untuk mulai merekam dan mentranskripsi.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {displayMeetings.map((meeting) => (
            <div
              key={meeting.id}
              onClick={() => onSelectMeeting(meeting.id, meeting.status)}
              className="bg-[#111113] hover:bg-[#151517] border border-white/5 hover:border-white/10 rounded-2xl p-5 flex flex-col justify-between gap-4 transition group cursor-pointer"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-white group-hover:text-indigo-400 transition leading-snug">
                    {meeting.title}
                  </h3>
                  {getStatusBadge(meeting.status)}
                </div>
                
                {meeting.description && (
                  <p className="text-xs text-gray-400 line-clamp-2 leading-relaxed">
                    {meeting.description}
                  </p>
                )}

                {/* Matching Transcript Snippets Display */}
                {meeting.matching_snippets && meeting.matching_snippets.length > 0 && (
                  <div className="bg-black/40 border border-white/5 rounded-xl p-3 space-y-1.5 text-xs">
                    <div className="text-[10px] font-mono text-indigo-400 uppercase tracking-wider flex items-center gap-1">
                      <Search size={10} /> Matching Transcript Snippets ({meeting.matching_snippets.length})
                    </div>
                    {meeting.matching_snippets.map((snip, sIdx) => (
                      <div key={sIdx} className="text-gray-300 leading-normal flex items-start gap-1.5 font-sans">
                        <span className="text-[10px] font-mono text-indigo-300 shrink-0 bg-indigo-500/10 px-1 py-0.5 rounded">
                          {formatDuration(snip.start_time)}
                        </span>
                        <span className="truncate">
                          <strong className="text-white font-semibold">{snip.speaker_name || snip.speaker_label}:</strong> {snip.text}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-white/5 pt-4 flex items-center justify-between text-[11px] text-gray-500">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono">
                  {meeting.client && (
                    <span className="flex items-center gap-1 text-gray-400 font-sans">
                      <Users size={11} />
                      {meeting.client}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Calendar size={11} />
                    {formatDate(meeting.created_at)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock size={11} />
                    {formatDuration(meeting.duration_seconds)}
                  </span>
                  <span className="flex items-center gap-1 uppercase">
                    {meeting.meeting_type === 'online' ? (
                      <><Video size={11} className="text-indigo-400" /> Online</>
                    ) : (
                      <><Mic size={11} className="text-purple-400" /> Offline</>
                    )}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => handleDelete(e, meeting.id)}
                    className="p-1.5 hover:bg-red-500/10 text-gray-500 hover:text-red-400 border border-transparent hover:border-red-500/15 rounded-lg transition"
                    title="Delete meeting"
                  >
                    <Trash2 size={13} />
                  </button>
                  <ChevronRight size={14} className="text-gray-600 group-hover:text-white transition group-hover:translate-x-0.5" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New Meeting Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-[#111113] border border-white/5 rounded-3xl p-6 w-full max-w-md space-y-6 shadow-2xl">
            <div className="space-y-1">
              <h2 className="text-lg font-bold text-white">Create New Meeting</h2>
              <p className="text-xs text-gray-400">Configure meeting metadata before starting the recorder</p>
            </div>

            <form onSubmit={handleCreateMeeting} className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-[10px] font-mono uppercase tracking-wider text-gray-500">Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Weekly Sync, Project Kickoff"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-black/40 border border-white/5 focus:border-indigo-500/30 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-gray-600 focus:outline-none transition"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-mono uppercase tracking-wider text-gray-500">Client / Team</label>
                  <input
                    type="text"
                    placeholder="e.g. Google, Internal"
                    value={client}
                    onChange={(e) => setClient(e.target.value)}
                    className="w-full bg-black/40 border border-white/5 focus:border-indigo-500/30 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-gray-600 focus:outline-none transition"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[10px] font-mono uppercase tracking-wider text-gray-500">Meeting Type</label>
                  <select
                    value={meetingType}
                    onChange={(e) => setMeetingType(e.target.value)}
                    className="w-full bg-black/40 border border-white/5 focus:border-indigo-500/30 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none transition cursor-pointer"
                  >
                    <option value="offline">Offline (Mic)</option>
                    <option value="online">Online (Tab/Mixer)</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[10px] font-mono uppercase tracking-wider text-gray-500">Description</label>
                <textarea
                  placeholder="Review agenda or key topics..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="w-full bg-black/40 border border-white/5 focus:border-indigo-500/30 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-gray-600 focus:outline-none transition resize-none"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 bg-white/5 hover:bg-white/10 text-white font-medium text-xs rounded-xl py-3 border border-white/5 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs rounded-xl py-3 border border-indigo-500/10 transition shadow-lg shadow-indigo-600/10 cursor-pointer"
                >
                  Start Recording Page
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
