import React, { useState, useEffect } from 'react';
import { Key, Shield, HelpCircle, ArrowRight, Settings as SettingsIcon, Mic, CheckCircle2, AlertCircle } from 'lucide-react';

export default function Settings() {
  const [apiKey, setApiKey] = useState('');
  const [isKeySet, setIsKeySet] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [permissionStatus, setPermissionStatus] = useState('prompt'); // 'granted' | 'denied' | 'prompt'

  const [transcriptionEngine, setTranscriptionEngine] = useState('auto'); // 'auto' | 'gemini' | 'local_whisper'

  const [googleCalendarUrl, setGoogleCalendarUrl] = useState('');
  const [googleApiKey, setGoogleApiKey] = useState('');

  useEffect(() => {
    fetchSettings();
    checkPermission();
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

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-fade-in">
      <div className="flex items-center gap-3">
        <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-xl">
          <SettingsIcon size={24} />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Settings</h1>
          <p className="text-sm text-gray-400">Configure your transcription engine, API key, and audio environment</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* API & Engine Settings Box */}
        <div className="md:col-span-2 space-y-6">
          <div className="bg-[#111113] border border-white/5 rounded-2xl p-6 space-y-6">
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
                  <option value="local_whisper">Local Offline Whisper (100% Private, Zero Cloud & Zero Mismatch)</option>
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
                  Dapatkan dari <strong>Google Calendar Settings → Integration → Secret address in iCal format</strong> untuk otomatis mengimpor agenda meeting harian Anda tanpa OAuth kompleks.
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

          {/* Privacy Note */}
          <div className="bg-indigo-500/5 border border-indigo-500/10 rounded-2xl p-6 flex gap-4">
            <Shield className="text-indigo-400 shrink-0" size={24} />
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-white">Local-First Privacy</h3>
              <p className="text-xs text-gray-400 leading-relaxed">
                MeetingScribe memprioritaskan privasi Anda. Semua rekaman audio, transkrip, ringkasan, dan API Key tersimpan sepenuhnya di perangkat lokal Anda. Tidak ada data yang diunggah ke server eksternal, kecuali pengiriman audio ke Gemini API untuk keperluan transkripsi.
              </p>
            </div>
          </div>
        </div>

        {/* Right Column (Virtual Audio & System Permissions) */}
        <div className="space-y-6">
          {/* BlackHole Setup Guide */}
          <div className="bg-[#111113] border border-white/5 rounded-2xl p-6 space-y-6">
            <div className="flex items-center gap-2 text-white font-medium border-b border-white/5 pb-4">
              <HelpCircle size={18} className="text-purple-400" />
              <h2>Virtual Audio Setup</h2>
            </div>

            <div className="space-y-4 text-xs text-gray-400 leading-relaxed">
              <p>
                Untuk merekam audio dari aplikasi desktop seperti Google Meet (di app), Zoom, atau Teams, macOS memerlukan <strong>virtual audio driver</strong>.
              </p>
              
              <div className="border border-white/5 bg-black/20 rounded-xl p-3 space-y-2">
                <div className="font-semibold text-white text-[11px] uppercase tracking-wider">Langkah Setup (Sekali saja):</div>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Install <strong>BlackHole 2ch</strong> via Brew atau website resmi.</li>
                  <li>Buka aplikasi <strong>Audio MIDI Setup</strong> bawaan macOS.</li>
                  <li>Klik tombol <strong>+</strong>, pilih <strong>Create Multi-Output Device</strong>.</li>
                  <li>Centang output utama Anda (headphone/speaker) dan <strong>BlackHole 2ch</strong>.</li>
                  <li>Atur output suara macOS Anda ke Multi-Output Device ini saat meeting.</li>
                </ol>
              </div>

              <p className="text-[11px] text-gray-500">
                Di halaman perekaman, pilih <strong>BlackHole 2ch</strong> pada input "System Audio" untuk menangkap suara lawan bicara, sementara mic Anda dipilih di input "Your Mic".
              </p>
            </div>
          </div>

          {/* System Permissions Manager */}
          <div className="bg-[#111113] border border-white/5 rounded-2xl p-6 space-y-6">
            <div className="flex items-center gap-2 text-white font-medium border-b border-white/5 pb-4">
              <Mic size={18} className="text-emerald-400" />
              <h2>System Permissions</h2>
            </div>

            <div className="space-y-4">
              <p className="text-xs text-gray-400 leading-relaxed">
                Berikan izin akses microphone di browser sebelum memulai perekaman agar listing microphone dapat berjalan dengan benar.
              </p>

              <div className="flex items-center justify-between p-3.5 bg-black/20 border border-white/5 rounded-xl">
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
                  className="w-full bg-white/5 hover:bg-white/10 text-white font-semibold text-xs rounded-xl py-3 border border-white/5 transition flex items-center justify-center gap-2 cursor-pointer"
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
