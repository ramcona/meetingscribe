import React, { useState, useEffect } from 'react';
import { 
  Key, Shield, HelpCircle, ArrowRight, Settings as SettingsIcon, Mic, 
  CheckCircle2, AlertCircle, HardDrive, Database, FileAudio, Trash2, 
  RefreshCw, Lock, ShieldCheck, Sparkles 
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

  useEffect(() => {
    fetchSettings();
    checkPermission();
    fetchStorageStats();
  }, []);

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
      }
    } catch (err) {
      console.error('Error fetching storage stats:', err);
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
      // Stop track immediately to release mic
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
    <div className="max-w-4xl mx-auto space-y-8 animate-fade-in pb-10">
      <div className="flex items-center gap-3">
        <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-xl shadow-lg shadow-indigo-500/10">
          <SettingsIcon size={24} />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Settings & Privacy</h1>
          <p className="text-sm text-gray-400">Manage transcription engine, data privacy guardrails, API keys, and storage</p>
        </div>
      </div>

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
    </div>
  );
}
