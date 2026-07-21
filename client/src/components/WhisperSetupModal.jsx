import React, { useState, useEffect, useRef } from 'react';
import { X, Download, Terminal, CheckCircle, AlertTriangle, Cpu, Zap, RefreshCw } from 'lucide-react';

/**
 * WhisperSetupModal
 * Shows when whisper.cpp is not yet installed.
 * Streams build+download progress via SSE.
 */
export default function WhisperSetupModal({ onClose, onDone }) {
  const [stage, setStage] = useState('idle'); // idle | running | done | error
  const [pct, setPct] = useState(0);
  const [logs, setLogs] = useState([]);
  const [errorMsg, setErrorMsg] = useState('');
  const logsEndRef = useRef(null);
  const eventSourceRef = useRef(null);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close();
    };
  }, []);

  const startSetup = () => {
    setStage('running');
    setLogs([]);
    setPct(0);
    setErrorMsg('');

    const es = new EventSource('http://localhost:3001/api/whisper-setup');
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        setPct(data.pct || 0);
        if (data.message) {
          setLogs(prev => [...prev, data.message]);
        }
        if (data.stage === 'done') {
          setStage('done');
          es.close();
          if (onDone) setTimeout(onDone, 1500);
        } else if (data.stage === 'error') {
          setStage('error');
          setErrorMsg(data.message);
          es.close();
        }
      } catch (err) {
        console.error('SSE parse error:', err);
      }
    };

    es.onerror = () => {
      setStage('error');
      setErrorMsg('Koneksi ke server terputus. Pastikan server backend berjalan.');
      es.close();
    };
  };

  const stageLabel = {
    idle: '',
    running: 'Sedang menyiapkan whisper.cpp...',
    done: 'whisper.cpp berhasil dipasang!',
    error: 'Setup gagal',
  }[stage];

  const stageColor = {
    idle: '',
    running: 'text-indigo-400',
    done: 'text-emerald-400',
    error: 'text-red-400',
  }[stage];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="relative bg-[#0f0f11] border border-white/10 rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-xl">
              <Zap size={20} className="text-indigo-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Setup whisper.cpp</h2>
              <p className="text-[11px] text-gray-400 mt-0.5">Akselerasi Metal GPU untuk transkripsi offline</p>
            </div>
          </div>
          {stage !== 'running' && (
            <button onClick={onClose} className="text-gray-500 hover:text-white transition cursor-pointer mt-0.5">
              <X size={16} />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {stage === 'idle' && (
            <>
              {/* Why section */}
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3 bg-white/3 border border-white/5 rounded-xl">
                  <Cpu size={15} className="text-indigo-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-white">Kenapa perlu ini?</p>
                    <p className="text-[11px] text-gray-400 leading-relaxed mt-0.5">
                      ONNX Whisper (bawaan) lambat karena berjalan di CPU JavaScript. whisper.cpp menggunakan 
                      <span className="text-indigo-300 font-medium"> Metal GPU Apple Silicon</span>, 
                      3-5× lebih cepat dan akurat.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="p-3 bg-amber-500/5 border border-amber-500/15 rounded-xl space-y-1">
                    <p className="text-amber-400 font-semibold">ONNX (sekarang)</p>
                    <p className="text-gray-400">~8-15 detik/chunk</p>
                    <p className="text-gray-400">CPU JavaScript</p>
                  </div>
                  <div className="p-3 bg-emerald-500/5 border border-emerald-500/15 rounded-xl space-y-1">
                    <p className="text-emerald-400 font-semibold">whisper.cpp (setelah)</p>
                    <p className="text-gray-400">~1-3 detik/chunk</p>
                    <p className="text-gray-400">Metal GPU native</p>
                  </div>
                </div>
              </div>

              {/* What will happen */}
              <div className="p-3 bg-black/30 border border-white/5 rounded-xl space-y-2">
                <p className="text-[11px] font-semibold text-gray-300 mb-2">Yang akan dijalankan (sekali saja):</p>
                {[
                  { icon: '📦', text: 'Clone repositori whisper.cpp dari GitHub' },
                  { icon: '⚙️', text: 'Compile binary C++ dengan Metal GPU support' },
                  { icon: '⬇️', text: 'Download model ggml-tiny.bin (~75MB) dari HuggingFace' },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px] text-gray-400">
                    <span>{item.icon}</span>
                    <span>{item.text}</span>
                  </div>
                ))}
                <p className="text-[10px] text-gray-500 mt-2 pt-2 border-t border-white/5">
                  Membutuhkan Xcode Command Line Tools dan internet. Estimasi: 2–5 menit.
                </p>
              </div>
            </>
          )}

          {/* Progress */}
          {(stage === 'running' || stage === 'done' || stage === 'error') && (
            <div className="space-y-3">
              {/* Status label */}
              <div className="flex items-center gap-2">
                {stage === 'running' && <RefreshCw size={13} className="text-indigo-400 animate-spin" />}
                {stage === 'done' && <CheckCircle size={13} className="text-emerald-400" />}
                {stage === 'error' && <AlertTriangle size={13} className="text-red-400" />}
                <span className={`text-xs font-semibold ${stageColor}`}>{stageLabel}</span>
                {stage === 'running' && <span className="text-xs text-gray-500 ml-auto font-mono">{pct}%</span>}
              </div>

              {/* Progress bar */}
              {(stage === 'running' || stage === 'done') && (
                <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}

              {/* Log terminal */}
              <div className="bg-black/50 border border-white/5 rounded-xl p-3 h-40 overflow-y-auto font-mono text-[10px] text-gray-300 space-y-0.5">
                <div className="flex items-center gap-1.5 mb-2 pb-1.5 border-b border-white/5">
                  <Terminal size={10} className="text-gray-500" />
                  <span className="text-gray-500">Build log</span>
                </div>
                {logs.map((line, i) => (
                  <div key={i} className="text-gray-400 leading-relaxed">&gt; {line}</div>
                ))}
                <div ref={logsEndRef} />
              </div>

              {stage === 'error' && (
                <div className="p-3 bg-red-500/5 border border-red-500/20 rounded-xl text-[11px] text-red-400 space-y-1">
                  <p className="font-semibold">Troubleshooting:</p>
                  <p>• Pastikan Xcode Command Line Tools terinstall: <span className="font-mono">xcode-select --install</span></p>
                  <p>• Pastikan cmake tersedia: <span className="font-mono">brew install cmake</span></p>
                  <p>• Pastikan koneksi internet aktif untuk clone & download model</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 pt-0 gap-3">
          {stage === 'idle' && (
            <>
              <button
                onClick={onClose}
                className="text-xs text-gray-400 hover:text-white transition cursor-pointer"
              >
                Nanti saja (pakai ONNX)
              </button>
              <button
                onClick={startSetup}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-5 py-2.5 rounded-xl transition cursor-pointer"
              >
                <Download size={13} />
                Pasang whisper.cpp Sekarang
              </button>
            </>
          )}
          {stage === 'error' && (
            <>
              <button onClick={onClose} className="text-xs text-gray-400 hover:text-white transition cursor-pointer">
                Tutup
              </button>
              <button
                onClick={startSetup}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-5 py-2.5 rounded-xl transition cursor-pointer"
              >
                <RefreshCw size={13} />
                Coba Lagi
              </button>
            </>
          )}
          {stage === 'done' && (
            <button
              onClick={onClose}
              className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-5 py-2.5 rounded-xl transition cursor-pointer"
            >
              <CheckCircle size={13} />
              Selesai — Live Transcript siap!
            </button>
          )}
          {stage === 'running' && (
            <p className="text-[11px] text-gray-500 w-full text-center">
              Jangan tutup jendela ini sampai proses selesai...
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
