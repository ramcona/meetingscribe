import React, { useEffect, useRef } from 'react';

export default function VUMeter({ stream, isActive }) {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);

  useEffect(() => {
    if (!isActive || !stream) {
      // Clear canvas if inactive
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // Draw empty indicator
        ctx.fillStyle = '#1F2937';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let audioContext;
    let analyser;
    let source;

    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 64;
      source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const draw = () => {
        if (!canvas) return;
        const width = canvas.width;
        const height = canvas.height;

        animationRef.current = requestAnimationFrame(draw);

        analyser.getByteFrequencyData(dataArray);

        // Calculate average volume
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        const volumePercentage = Math.min(100, (average / 140) * 100); // Scale appropriately

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // Draw background track
        ctx.fillStyle = 'rgba(255,255,255,0.03)';
        ctx.fillRect(0, 0, width, height);

        // Draw volume level bar with gradient
        const grad = ctx.createLinearGradient(0, 0, width, 0);
        grad.addColorStop(0, '#6366F1'); // Indigo
        grad.addColorStop(0.7, '#8B5CF6'); // Purple
        grad.addColorStop(1, '#EC4899'); // Pink (peak)

        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, (width * volumePercentage) / 100, height);
      };

      draw();
    } catch (e) {
      console.error('Error creating VU Meter:', e);
    }

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (source) source.disconnect();
      if (analyser) analyser.disconnect();
      if (audioContext) audioContext.close();
    };
  }, [stream, isActive]);

  return (
    <div className="flex items-center gap-2 w-full">
      <div className="text-xs text-gray-500 font-mono w-10">LEVEL</div>
      <div className="relative flex-1 h-3 rounded-full overflow-hidden border border-white/5 bg-black/30">
        <canvas
          ref={canvasRef}
          width={300}
          height={12}
          className="absolute inset-0 w-full h-full"
        />
      </div>
    </div>
  );
}
