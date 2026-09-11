import React, { useState, useEffect, useRef } from 'react';
import { Cpu, MemoryStick } from 'lucide-react';

function MiniBar({ pct, color }) {
  return (
    <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-700 ease-out ${color}`}
        style={{ width: `${Math.min(100, pct)}%` }}
      />
    </div>
  );
}

function colorFor(pct) {
  if (pct >= 85) return 'bg-red-500';
  if (pct >= 60) return 'bg-amber-400';
  return 'bg-emerald-400';
}

export default function SystemStats() {
  const [stats, setStats] = useState(null);
  const [prev, setPrev] = useState(null);
  const intervalRef = useRef(null);

  const fetchStats = () => {
    fetch('http://localhost:3001/api/system-stats')
      .then(r => r.json())
      .then(data => {
        setPrev(s => s);
        setStats(data);
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchStats();
    intervalRef.current = setInterval(fetchStats, 3000);
    return () => clearInterval(intervalRef.current);
  }, []);

  if (!stats) {
    return (
      <div className="space-y-2 opacity-40 animate-pulse">
        <div className="h-1 w-full bg-white/5 rounded-full" />
        <div className="h-1 w-full bg-white/5 rounded-full" />
      </div>
    );
  }

  const { cpu_pct, ram_used_mb, ram_total_mb, ram_pct } = stats;

  const ramUsedGb = ram_used_mb >= 1024
    ? `${(ram_used_mb / 1024).toFixed(1)} GB`
    : `${ram_used_mb} MB`;
  const ramTotalGb = ram_total_mb >= 1024
    ? `${(ram_total_mb / 1024).toFixed(1)} GB`
    : `${ram_total_mb} MB`;

  return (
    <div className="space-y-3">
      {/* CPU */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Cpu size={10} className={colorFor(cpu_pct)} />
            <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">CPU</span>
          </div>
          <span
            className={`text-[10px] font-mono font-semibold tabular-nums transition-colors duration-500 ${
              cpu_pct >= 85 ? 'text-red-400' : cpu_pct >= 60 ? 'text-amber-400' : 'text-emerald-400'
            }`}
          >
            {cpu_pct}%
          </span>
        </div>
        <MiniBar pct={cpu_pct} color={colorFor(cpu_pct)} />
      </div>

      {/* RAM */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <MemoryStick size={10} className={colorFor(ram_pct)} />
            <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">RAM</span>
          </div>
          <span
            title={`Memori sistem: ${ramUsedGb} aktif & cache / ${ramTotalGb} total`}
            className={`text-[10px] font-mono font-semibold tabular-nums transition-colors duration-500 cursor-help ${
              ram_pct >= 95 ? 'text-amber-400' : 'text-emerald-400'
            }`}
          >
            {ram_pct}%
          </span>
        </div>
        <MiniBar pct={ram_pct} color={ram_pct >= 95 ? 'bg-amber-400' : 'bg-emerald-400'} />
      </div>
    </div>
  );
}
