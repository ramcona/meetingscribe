import React, { useState, useEffect, useRef } from 'react';
import { 
  Key, Shield, HelpCircle, ArrowRight, Settings as SettingsIcon, Mic, 
  CheckCircle2, AlertCircle, HardDrive, Database, FileAudio, Trash2, 
  RefreshCw, Lock, ShieldCheck, Sparkles, Terminal, Download, Copy, 
  Bug, Activity, Filter, Check, Search, Code, Server, Cpu
} from 'lucide-react';

export default function Settings() {
  const [apiKey, setApiKey] = useState('');
  const [isKeySet, setIsKeySet] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [permissionStatus, setPermissionStatus] = useState('prompt'); // 'granted' | 'denied' | 'prompt'

  const [transcriptionEngine, setTranscriptionEngine] = useState('auto'); // 'auto' | 'gemini' | 'local_whisper'

  const [googleCalendarUrl, setGoogleCalendarUrl] = useState('');
  const [googleApiKey, setGoogleApiKey] = useState('');

  const [storageStats, setStorageStats] = useState(null);
  const [cleaningStorage, setCleaningStorage] = useState(false);

  // Activity Logs & Diagnostics states
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logFilter, setLogFilter] = useState('all'); // 'all' | 'error' | 'server' | 'client'
  const [logSearch, setLogSearch] = useState('');
  const [autoRefreshLogs, setAutoRefreshLogs] = useState(true);
  const [copiedLog, setCopiedLog] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState(null);
  const [systemStatus, setSystemStatus] = useState(null);

  const logEndRef = useRef(null);

  useEffect(() => {
    fetchSettings();
    checkPermission();
    fetchStorageStats();
    fetchSystemStatus();
    fetchLogs();
  }, []);

  useEffect(() => {
    let interval;
    if (autoRefreshLogs) {
      interval = setInterval(() => {
        fetchLogs(true);
        fetchSystemStatus();
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [autoRefreshLogs]);

  const fetchSystemStatus = async () => {
    if (window.electronAPI && window.electronAPI.getSystemStatus) {
      try {
        const status = await window.electronAPI.getSystemStatus();
        setSystemStatus(status);
      } catch (err) {
        console.error('Error fetching IPC system status:', err);
      }
    }
  };

  const fetchLogs = async (silent = false) => {
    if (!silent) setLogsLoading(true);
    try {
      let fetchedLogs = [];
      // Try Electron IPC first
      if (window.electronAPI && window.electronAPI.getActivityLogs) {
        fetchedLogs = await window.electronAPI.getActivityLogs();
      } else {
        // Fallback to Express HTTP API
        const res = await fetch('http://localhost:3001/api/logs');
        if (res.ok) {
          fetchedLogs = await res.json();
        }
      }
      setLogs(fetchedLogs || []);
    } catch (err) {
      console.error('Error fetching logs:', err);
    } finally {
      if (!silent) setLogsLoading(false);
    }
  };

  const handleClearLogs = async () => {
    try {
      if (window.electronAPI && window.electronAPI.clearActivityLogs) {
        await window.electronAPI.clearActivityLogs();
      } else {
        await fetch('http://localhost:3001/api/logs', { method: 'DELETE' });
      }
      setLogs([]);
    } catch (err) {
      console.error('Error clearing logs:', err);
    }
  };

  const handleToggleDevTools = async () => {
    if (window.electronAPI && window.electronAPI.toggleDevTools) {
      await window.electronAPI.toggleDevTools();
    } else {
      alert('Developer Tools IPC available only inside Electron App environment.');
    }
  };

  const filteredLogs = logs.filter(log => {
    if (logFilter === 'error' && log.level !== 'ERROR') return false;
    if (logFilter === 'server' && !['Server', 'Main', 'Electron', 'DB'].includes(log.source)) return false;
    if (logFilter === 'client' && log.source !== 'Client' && log.source !== 'Console') return false;
    
    if (logSearch.trim()) {
      const q = logSearch.toLowerCase();
      const matchMsg = log.message && log.message.toLowerCase().includes(q);
      const matchSource = log.source && log.source.toLowerCase().includes(q);
      const matchDetails = log.details && log.details.toLowerCase().includes(q);
      return matchMsg || matchSource || matchDetails;
    }
    return true;
  });

  const handleCopyLogs = () => {
    const text = filteredLogs.map(l => `[${l.timestamp}] [${l.level}] [${l.source}] ${l.message}${l.details ? '\nDetails: ' + l.details : ''}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopiedLog(true);
    setTimeout(() => setCopiedLog(false), 2000);
  };

  const handleExportLogs = () => {
    const text = filteredLogs.map(l => `[${l.timestamp}] [${l.level}] [${l.source}] ${l.message}${l.details ? '\nDetails: ' + l.details : ''}`).join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `meetingscribe-activity-logs-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch('http://localhost:3001/api/settings');
      if (res.ok) {
        const data = await res.json();
        setIsKeySet(data.gemini_api_key_set);
        if (data.transcription_engine) {
          setTranscriptionEngine(data.transcription_engine);
        }
        if (data.google_calendar_ical_url) {
          setGoogleCalendarUrl(data.google_calendar_ical_url);
        }
      }
    } catch (err) {
      console.error('Error fetching settings:', err);
    }
  };

  const fetchStorageStats = async () => {
    try {
      const res = await fetch('http://localhost:3001/api/storage');
      if (res.ok) {
        const data = await res.json();
        setStorageStats(data);
      } else {
        setStorageStats({
          db_size_bytes: 0,
          recordings_size_bytes: 0,
          total_storage_bytes: 0,
          recordings_count: 0,
          meetings_count: 0,
          total_duration_seconds: 0
        });
      }
    } catch (err) {
      console.error('Error fetching storage stats:', err);
      setStorageStats({
        db_size_bytes: 0,
        recordings_size_bytes: 0,
        total_storage_bytes: 0,
        recordings_count: 0,
        meetings_count: 0,
        total_duration_seconds: 0
      });
    }
  };

  const handleCleanupStorage = async () => {
    setCleaningStorage(true);
    try {
      const res = await fetch('http://localhost:3001/api/storage/cleanup', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setMessage({ 
          text: data.deleted_files_count > 0 
            ? `Berhasil membersihkan ${data.deleted_files_count} file sisa (${formatBytes(data.reclaimed_bytes)} dibebaskan).`
            : 'Storage sudah bersih! Tidak ada file sisa yang perlu dihapus.', 
          type: 'success' 
        });
        fetchStorageStats();
      }
    } catch (err) {
      setMessage({ text: 'Gagal melakukan pembersihan storage.', type: 'error' });
    } finally {
      setCleaningStorage(false);
    }
  };

  const checkPermission = async () => {
    if (navigator.permissions && navigator.permissions.query) {
      try {
        const status = await navigator.permissions.query({ name: 'microphone' });
        setPermissionStatus(status.state);
        status.onchange = () => {
          setPermissionStatus(status.state);
        };
      } catch (err) {
        console.error('Error checking microphone permission:', err);
      }
    }
  };

  const handleRequestPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      setPermissionStatus('granted');
    } catch (err) {
      console.error('Permission request rejected:', err);
      setPermissionStatus('denied');
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage({ text: '', type: '' });

    try {
      const payload = {
        transcription_engine: transcriptionEngine,
        google_calendar_ical_url: googleCalendarUrl.trim()
      };
      if (apiKey.trim()) {
        payload.gemini_api_key = apiKey.trim();
      }
      if (googleApiKey.trim()) {
        payload.google_api_key = googleApiKey.trim();
      }

      const res = await fetch('http://localhost:3001/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        setMessage({ text: 'Pengaturan berhasil disimpan!', type: 'success' });
        if (apiKey.trim()) setIsKeySet(true);
        setApiKey('');
        setGoogleApiKey('');
      } else {
        setMessage({ text: 'Gagal menyimpan pengaturan.', type: 'error' });
      }
    } catch (err) {
      setMessage({ text: 'Gagal terhubung ke backend server.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const formatBytes = (bytes) => {
    if (bytes === 0 || !bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDuration = (totalSeconds) => {
    if (!totalSeconds || totalSeconds <= 0) return '0 m';
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (hours > 0) return `${hours}j ${minutes}m`;
    return `${minutes}m`;
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-fade-in pb-16">
      <div className="flex items-center gap-3">
        <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-xl shadow-lg shadow-indigo-500/10">
          <SettingsIcon size={24} />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Settings & System Diagnostics</h1>
          <p className="text-sm text-gray-400">Manage transcription engine, view live activity logs, API keys, and system stats</p>
        </div>
      </div>

      {/* Backend Error / Warning Banner */}
      {systemStatus && systemStatus.backendError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-5 space-y-3 shadow-xl">
          <div className="flex items-center gap-3 text-red-400 font-semibold text-sm">
            <AlertCircle size={20} className="shrink-0" />
            <span>Backend Server Diagnostic Alert: Failed to Start Native Express Backend</span>
          </div>
          <div className="text-xs text-gray-300 font-mono bg-black/50 p-3 rounded-xl border border-red-500/20 whitespace-pre-wrap max-h-36 overflow-y-auto">
            {systemStatus.backendError}
          </div>
          <div className="flex items-center justify-between text-xs text-gray-400 pt-1">
            <span>Gunakan tombol <strong>Developer Tools</strong> di bawah untuk membaca console error lengkap.</span>
            <button
              onClick={handleToggleDevTools}
              className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-300 font-medium rounded-lg transition border border-red-500/30 cursor-pointer"
            >
              Open DevTools
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* API & Engine Settings Box */}
        <div className="md:col-span-2 space-y-6">
          <div className="bg-[#111113] border border-white/5 rounded-2xl p-6 space-y-6 shadow-xl">
            <div className="flex items-center gap-2 text-white font-medium border-b border-white/5 pb-4">
              <Key size={18} className="text-indigo-400" />
              <h2>Transcription Engine & API Configuration</h2>
            </div>

            <form onSubmit={handleSave} className="space-y-6">
              {/* Engine Preference Choice */}
              <div className="space-y-2">
                <label className="block text-xs font-mono text-gray-400 uppercase tracking-wider">
                  Engine Transkripsi Utama
                </label>
                <select
                  value={transcriptionEngine}
                  onChange={(e) => setTranscriptionEngine(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 focus:border-indigo-500/50 rounded-xl px-4 py-3 text-xs text-white focus:outline-none transition cursor-pointer"
                >
                  <option value="auto">Auto (Gemini AI Cloud + Fallback Local Whisper Offline)</option>
                  <option value="gemini">Google Gemini 3.5 Flash (Cloud - Diarization & Fast)</option>
                  <option value="local_whisper">Local Offline Whisper (100% Private, Zero Cloud & Zero Internet)</option>
                </select>
                <p className="text-[11px] text-gray-500 leading-relaxed">
                  Mode <strong>Local Offline Whisper</strong> berjalan sepenuhnya di komputer lokal Anda tanpa membutuhkan koneksi internet atau kuota API.
                </p>
              </div>

              {/* Gemini API Key */}
              <div>
                <label className="block text-xs font-mono text-gray-400 uppercase tracking-wider mb-2">
                  Gemini API Key
                </label>
                <div className="relative">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={isKeySet ? "••••••••••••••••••••••••••••••••" : "Masukkan Gemini API Key (Opsional untuk Local Mode)"}
                    className="w-full bg-black/40 border border-white/10 focus:border-indigo-500/50 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none transition"
                  />
                  <div className="absolute right-3 top-3.5">
                    {isKeySet ? (
                      <span className="flex h-2 w-2 relative">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                      </span>
                    ) : (
                      <span className="flex h-2 w-2 rounded-full bg-yellow-500/50"></span>
                    )}
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  API Key disimpan secara lokal di database SQLite komputer Anda dan hanya digunakan untuk memanggil Gemini API.
                </p>
              </div>

              {/* Google Calendar iCal Feed URL */}
              <div className="border-t border-white/5 pt-4 space-y-2">
                <label className="block text-xs font-mono text-gray-400 uppercase tracking-wider">
                  Google Calendar iCal Feed URL (Opsional)
                </label>
                <input
                  type="url"
                  value={googleCalendarUrl}
                  onChange={(e) => setGoogleCalendarUrl(e.target.value)}
                  placeholder="https://calendar.google.com/calendar/ical/your_email/private-xxxx/basic.ics"
                  className="w-full bg-black/40 border border-white/10 focus:border-indigo-500/50 rounded-xl px-4 py-3 text-xs text-white placeholder-gray-600 focus:outline-none transition"
                />
                <p className="text-[11px] text-gray-500 leading-relaxed">
                  Dapatkan dari <strong>Google Calendar Settings → Integration → Secret address in iCal format</strong> untuk otomatis mengimpor agenda meeting harian Anda.
                </p>
              </div>

              {message.text && (
                <div className={`p-4 rounded-xl text-sm border ${
                  message.type === 'success' 
                    ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400' 
                    : 'bg-red-500/5 border-red-500/20 text-red-400'
                }`}>
                  {message.text}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium rounded-xl py-3 text-sm transition shadow-lg shadow-indigo-600/10 cursor-pointer"
              >
                {loading ? 'Menyimpan...' : 'Simpan Pengaturan Engine'}
              </button>
            </form>
          </div>

          {/* Privacy & Gemini Model Training Protection Card */}
          <div className="bg-[#111113] border border-indigo-500/20 rounded-2xl p-6 space-y-5 relative overflow-hidden shadow-xl">
            <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none"></div>
            
            <div className="flex items-center gap-3 border-b border-white/5 pb-4">
              <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400">
                <ShieldCheck size={20} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Data Privacy & Gemini Safety Guarantee</h3>
                <p className="text-xs text-gray-400">Keamanan data suara & transkrip Anda terjamin 100%</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="p-3.5 bg-black/30 border border-white/5 rounded-xl space-y-1.5">
                <div className="flex items-center gap-2 font-medium text-emerald-400">
                  <Lock size={14} /> Zero Model Training
                </div>
                <p className="text-gray-400 leading-relaxed text-[11px]">
                  Data audio dan prompt yang dikirim via Gemini API Key Anda <strong>TIDAK DIGUNAKAN</strong> oleh Google untuk melatih model AI publik.
                </p>
              </div>

              <div className="p-3.5 bg-black/30 border border-white/5 rounded-xl space-y-1.5">
                <div className="flex items-center gap-2 font-medium text-indigo-400">
                  <Trash2 size={14} /> Auto Cloud Storage Purge
                </div>
                <p className="text-gray-400 leading-relaxed text-[11px]">
                  Setiap file audio yang diunggah sementara ke Gemini Files API langsung <strong>DIHAPUS OTOMATIS</strong> dari server cloud seketika transkripsi selesai.
                </p>
              </div>
            </div>

            <div className="bg-indigo-950/20 border border-indigo-500/15 rounded-xl p-4 flex gap-3 text-xs text-gray-300">
              <Sparkles size={16} className="text-indigo-400 shrink-0 mt-0.5" />
              <p className="leading-relaxed text-[11px]">
                Seluruh rekaman audio mentah, transkrip percakapan, ringkasan meeting, dan database SQLite Anda disimpan <strong>100% di harddisk lokal Anda</strong>. Jika Anda memerlukan privasi mutlak tanpa koneksi internet sama sekali, gunakan mode <strong>Local Offline Whisper</strong>.
              </p>
            </div>
          </div>
        </div>

        {/* Right Column (Storage Usage & System Setup) */}
        <div className="space-y-6">
          {/* Storage Usage Widget */}
          <div className="bg-[#111113] border border-white/5 rounded-2xl p-6 space-y-5 shadow-xl">
            <div className="flex items-center justify-between border-b border-white/5 pb-4">
              <div className="flex items-center gap-2 text-white font-medium">
                <HardDrive size={18} className="text-cyan-400" />
                <h2>Storage Usage</h2>
              </div>
              <button
                onClick={fetchStorageStats}
                className="p-1.5 hover:bg-white/5 rounded-lg text-gray-400 hover:text-white transition cursor-pointer"
                title="Refresh Storage Usage"
              >
                <RefreshCw size={14} />
              </button>
            </div>

            {storageStats ? (
              <div className="space-y-4">
                {/* Total Usage Banner */}
                <div className="p-4 bg-black/40 border border-white/5 rounded-xl flex items-baseline justify-between">
                  <div>
                    <div className="text-[10px] font-mono text-gray-400 uppercase tracking-wider">Total Storage Used</div>
                    <div className="text-2xl font-bold text-white mt-0.5">
                      {formatBytes(storageStats.total_storage_bytes)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] font-mono text-gray-400 uppercase tracking-wider">Total Audio</div>
                    <div className="text-sm font-semibold text-indigo-400 mt-0.5">
                      {formatDuration(storageStats.total_duration_seconds)}
                    </div>
                  </div>
                </div>

                {/* Storage Breakdown Bar */}
                <div className="space-y-2">
                  <div className="h-2.5 w-full bg-white/5 rounded-full overflow-hidden flex">
                    <div 
                      className="bg-indigo-500 transition-all duration-500" 
                      style={{ 
                        width: `${storageStats.total_storage_bytes > 0 
                          ? Math.max(5, (storageStats.recordings_size_bytes / storageStats.total_storage_bytes) * 100) 
                          : 0}%` 
                      }}
                      title="Audio Recordings"
                    ></div>
                    <div 
                      className="bg-cyan-400 transition-all duration-500" 
                      style={{ 
                        width: `${storageStats.total_storage_bytes > 0 
                          ? Math.max(5, (storageStats.db_size_bytes / storageStats.total_storage_bytes) * 100) 
                          : 0}%` 
                      }}
                      title="SQLite Database"
                    ></div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px] font-mono pt-1">
                    <div className="flex items-center gap-1.5 text-gray-300">
                      <span className="h-2 w-2 rounded-full bg-indigo-500"></span>
                      <span>Audio Files:</span>
                      <span className="text-white font-semibold">{formatBytes(storageStats.recordings_size_bytes)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-gray-300">
                      <span className="h-2 w-2 rounded-full bg-cyan-400"></span>
                      <span>Database:</span>
                      <span className="text-white font-semibold">{formatBytes(storageStats.db_size_bytes)}</span>
                    </div>
                  </div>
                </div>

                {/* Storage Details List */}
                <div className="space-y-2 text-xs border-t border-white/5 pt-3">
                  <div className="flex items-center justify-between text-gray-400 py-1">
                    <span className="flex items-center gap-2"><FileAudio size={14} className="text-indigo-400" /> Recorded Files</span>
                    <span className="text-white font-medium">{storageStats.recordings_count} file</span>
                  </div>
                  <div className="flex items-center justify-between text-gray-400 py-1">
                    <span className="flex items-center gap-2"><Database size={14} className="text-cyan-400" /> Meetings Saved</span>
                    <span className="text-white font-medium">{storageStats.meetings_count} meeting</span>
                  </div>
                </div>

                {/* Cleanup Action */}
                <button
                  onClick={handleCleanupStorage}
                  disabled={cleaningStorage}
                  className="w-full mt-2 bg-white/5 hover:bg-white/10 disabled:opacity-50 text-gray-300 hover:text-white font-medium text-xs py-2.5 rounded-xl border border-white/5 transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Trash2 size={13} className="text-amber-400" />
                  {cleaningStorage ? 'Clearing Temp Files...' : 'Clean Up Temp Recording Files'}
                </button>
              </div>
            ) : (
              <div className="text-xs text-gray-500 text-center py-4">Memuat informasi storage...</div>
            )}
          </div>

          {/* Virtual Audio Setup Guide */}
          <div className="bg-[#111113] border border-white/5 rounded-2xl p-6 space-y-4 shadow-xl">
            <div className="flex items-center gap-2 text-white font-medium border-b border-white/5 pb-3">
              <HelpCircle size={18} className="text-purple-400" />
              <h2>Virtual Audio Setup</h2>
            </div>

            <div className="space-y-3 text-xs text-gray-400 leading-relaxed">
              <p>
                Untuk merekam audio dari Google Meet, Zoom, atau Teams di macOS, gunakan <strong>BlackHole 2ch</strong>.
              </p>
              
              <div className="border border-white/5 bg-black/20 rounded-xl p-3 space-y-1.5 text-[11px]">
                <div className="font-semibold text-white uppercase tracking-wider text-[10px]">Setup Cepat:</div>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Install BlackHole 2ch via Brew atau website.</li>
                  <li>Buka <strong>Audio MIDI Setup</strong> bawaan macOS.</li>
                  <li>Buat <strong>Multi-Output Device</strong> (Speaker + BlackHole).</li>
                </ol>
              </div>
            </div>
          </div>

          {/* System Permissions Manager */}
          <div className="bg-[#111113] border border-white/5 rounded-2xl p-6 space-y-4 shadow-xl">
            <div className="flex items-center gap-2 text-white font-medium border-b border-white/5 pb-3">
              <Mic size={18} className="text-emerald-400" />
              <h2>System Permissions</h2>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-black/20 border border-white/5 rounded-xl">
                <div className="space-y-0.5">
                  <div className="text-xs font-medium text-white">Microphone Access</div>
                  <div className="text-[10px] text-gray-500 font-mono">
                    Status: {permissionStatus.toUpperCase()}
                  </div>
                </div>

                {permissionStatus === 'granted' ? (
                  <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-semibold">
                    <CheckCircle2 size={14} /> Allowed
                  </span>
                ) : permissionStatus === 'denied' ? (
                  <span className="flex items-center gap-1.5 text-xs text-red-400 font-semibold">
                    <AlertCircle size={14} /> Blocked
                  </span>
                ) : (
                  <span className="flex h-2 w-2 rounded-full bg-yellow-500/50"></span>
                )}
              </div>

              {permissionStatus !== 'granted' && (
                <button
                  onClick={handleRequestPermission}
                  className="w-full bg-white/5 hover:bg-white/10 text-white font-semibold text-xs rounded-xl py-2.5 border border-white/5 transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Mic size={13} />
                  Request Microphone Access
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* NEW: Full Activity Log & System Diagnostics Section */}
      <div className="bg-[#111113] border border-white/5 rounded-2xl p-6 space-y-6 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl">
              <Terminal size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                System Activity Log & Diagnostics
                <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 text-[10px] font-mono rounded-full border border-emerald-500/20">
                  Live
                </span>
              </h2>
              <p className="text-xs text-gray-400">
                Log aktivitas real-time aplikasi, backend process, database, dan IPC events untuk diagnosa rilis build
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleToggleDevTools}
              className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 border border-indigo-500/20 rounded-xl text-xs font-medium transition cursor-pointer"
              title="Open Electron Developer Tools"
            >
              <Code size={14} />
              DevTools
            </button>
            <button
              onClick={handleExportLogs}
              className="flex items-center gap-1.5 px-3 py-2 bg-white/5 hover:bg-white/10 text-gray-300 border border-white/5 rounded-xl text-xs font-medium transition cursor-pointer"
              title="Export Log File"
            >
              <Download size={14} />
              Export
            </button>
            <button
              onClick={handleCopyLogs}
              className="flex items-center gap-1.5 px-3 py-2 bg-white/5 hover:bg-white/10 text-gray-300 border border-white/5 rounded-xl text-xs font-medium transition cursor-pointer"
              title="Copy All Logs"
            >
              {copiedLog ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
              {copiedLog ? 'Copied!' : 'Copy'}
            </button>
            <button
              onClick={handleClearLogs}
              className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-xl transition cursor-pointer"
              title="Clear Logs"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {/* System Diagnostics Specs Bar */}
        {systemStatus && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
            <div className="p-3 bg-black/30 border border-white/5 rounded-xl flex items-center gap-2.5">
              <Server size={16} className={systemStatus.backendError ? "text-red-400" : "text-emerald-400"} />
              <div>
                <div className="text-[10px] text-gray-500">Backend Status</div>
                <div className={systemStatus.backendError ? "text-red-400 font-semibold" : "text-emerald-400 font-semibold"}>
                  {systemStatus.backendError ? 'Error Startup' : 'Running (3001)'}
                </div>
              </div>
            </div>

            <div className="p-3 bg-black/30 border border-white/5 rounded-xl flex items-center gap-2.5">
              <Cpu size={16} className="text-indigo-400" />
              <div>
                <div className="text-[10px] text-gray-500">Electron / Node</div>
                <div className="text-white font-semibold">
                  v{systemStatus.electronVersion || 'N/A'} / {systemStatus.nodeVersion}
                </div>
              </div>
            </div>

            <div className="p-3 bg-black/30 border border-white/5 rounded-xl flex items-center gap-2.5">
              <Activity size={16} className="text-cyan-400" />
              <div>
                <div className="text-[10px] text-gray-500">Environment</div>
                <div className="text-white font-semibold">
                  {systemStatus.isDev ? 'Development' : 'Production Build'}
                </div>
              </div>
            </div>

            <div className="p-3 bg-black/30 border border-white/5 rounded-xl flex items-center gap-2.5 truncate">
              <HardDrive size={16} className="text-amber-400 shrink-0" />
              <div className="min-w-0 truncate">
                <div className="text-[10px] text-gray-500">User Data Dir</div>
                <div className="text-gray-300 font-semibold truncate text-[10px]" title={systemStatus.userDataPath}>
                  {systemStatus.userDataPath}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Filter and Search Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-black/30 p-3 border border-white/5 rounded-xl">
          {/* Filter Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto">
            <button
              onClick={() => setLogFilter('all')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition cursor-pointer ${
                logFilter === 'all' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              Semua ({logs.length})
            </button>
            <button
              onClick={() => setLogFilter('error')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition cursor-pointer ${
                logFilter === 'error' ? 'bg-red-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              Errors ({logs.filter(l => l.level === 'ERROR').length})
            </button>
            <button
              onClick={() => setLogFilter('server')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition cursor-pointer ${
                logFilter === 'server' ? 'bg-cyan-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              Server/Main
            </button>
            <button
              onClick={() => setLogFilter('client')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition cursor-pointer ${
                logFilter === 'client' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              Frontend
            </button>
          </div>

          <div className="flex items-center gap-3">
            {/* Search Box */}
            <div className="relative flex-1 sm:w-60">
              <Search size={14} className="absolute left-3 top-2.5 text-gray-500" />
              <input
                type="text"
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
                placeholder="Cari kata kunci log..."
                className="w-full bg-black/50 border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
              />
            </div>

            {/* Auto Refresh Switch */}
            <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer select-none shrink-0">
              <input
                type="checkbox"
                checked={autoRefreshLogs}
                onChange={(e) => setAutoRefreshLogs(e.target.checked)}
                className="rounded border-white/10 bg-black/40 text-indigo-600 focus:ring-0"
              />
              <span>Live Auto-Sync</span>
            </label>

            <button
              onClick={() => fetchLogs()}
              className="p-1.5 hover:bg-white/5 text-gray-400 hover:text-white rounded-lg transition cursor-pointer"
              title="Manual Refresh Logs"
            >
              <RefreshCw size={14} className={logsLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Monospace Console Output Stream */}
        <div className="bg-[#070709] border border-white/10 rounded-xl p-4 font-mono text-xs max-h-96 overflow-y-auto space-y-2 select-text">
          {filteredLogs.length === 0 ? (
            <div className="text-center py-10 text-gray-600 italic">
              {logSearch ? 'Tidak ada log yang cocok dengan pencarian' : 'Belum ada catatan activity log terdaftar'}
            </div>
          ) : (
            filteredLogs.map((log) => {
              const levelColor = 
                log.level === 'ERROR' ? 'bg-red-500/10 text-red-400 border-red-500/30' :
                log.level === 'WARN' ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' :
                log.level === 'SUCCESS' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' :
                'bg-cyan-500/10 text-cyan-400 border-cyan-500/30';

              const sourceColor = 
                log.source === 'Server' ? 'text-indigo-400' :
                log.source === 'Electron' ? 'text-purple-400' :
                log.source === 'DB' ? 'text-cyan-400' :
                log.source === 'Whisper' ? 'text-emerald-400' :
                log.source === 'Gemini' ? 'text-amber-400' :
                'text-gray-400';

              return (
                <div 
                  key={log.id} 
                  className="p-2 hover:bg-white/[0.02] rounded-lg transition border border-transparent hover:border-white/5"
                >
                  <div className="flex items-start gap-2 flex-wrap">
                    <span className="text-gray-600 text-[10px] shrink-0">
                      {log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : ''}
                    </span>

                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border uppercase ${levelColor}`}>
                      {log.level}
                    </span>

                    <span className={`font-semibold text-[11px] ${sourceColor}`}>
                      [{log.source}]
                    </span>

                    <span className="text-gray-200 flex-1 break-all leading-relaxed">
                      {log.message}
                    </span>

                    {log.details && (
                      <button
                        onClick={() => setExpandedLogId(expandedLogId === log.id ? null : log.id)}
                        className="text-[10px] text-indigo-400 hover:underline shrink-0 ml-auto"
                      >
                        {expandedLogId === log.id ? 'Sembunyikan Details' : 'Lihat Stack/Details'}
                      </button>
                    )}
                  </div>

                  {log.details && expandedLogId === log.id && (
                    <div className="mt-2 p-3 bg-black/60 rounded-lg text-[10px] text-gray-300 font-mono whitespace-pre-wrap border border-white/5 overflow-x-auto">
                      {log.details}
                    </div>
                  )}
                </div>
              );
            })
          )}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  );
}
