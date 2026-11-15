import { useEffect, useRef } from 'react';

export default function AudioWaveform({ active = false, stream = null }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const audioCtxRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    if (!active) {
      // Draw static/resting waveform
      ctx.clearRect(0, 0, width, height);
      const barCount = 28;
      const barWidth = 3;
      const gap = (width - barCount * barWidth) / (barCount - 1);
      ctx.fillStyle = '#cbd5cc';
      for (let i = 0; i < barCount; i++) {
        const h = 4 + Math.sin(i * 0.4) * 3;
        const x = i * (barWidth + gap);
        const y = (height - h) / 2;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, h, 2);
        ctx.fill();
      }
      return;
    }

    let analyser;
    let dataArray;
    let source;

    if (stream) {
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        const audioCtx = new AudioContext();
        audioCtxRef.current = audioCtx;
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);
        dataArray = new Uint8Array(analyser.frequencyBinCount);
      } catch {
        // Fallback to simulated animation if AudioContext blocked
      }
    }

    let frame = 0;
    function render() {
      frame++;
      ctx.clearRect(0, 0, width, height);
      const barCount = 28;
      const barWidth = 3;
      const gap = (width - barCount * barWidth) / (barCount - 1);

      if (analyser && dataArray) {
        analyser.getByteFrequencyData(dataArray);
      }

      for (let i = 0; i < barCount; i++) {
        let normalized = 0.2;
        if (analyser && dataArray) {
          const val = dataArray[i % dataArray.length] / 255;
          normalized = Math.max(0.1, val);
        } else {
          // Synthetic dynamic wave
          normalized = 0.2 + 0.6 * Math.abs(Math.sin((frame + i * 8) * 0.08));
        }

        const h = Math.min(height, Math.max(4, normalized * height));
        const x = i * (barWidth + gap);
        const y = (height - h) / 2;

        // Gradient color for active wave
        const grad = ctx.createLinearGradient(0, y, 0, y + h);
        grad.addColorStop(0, '#537d50');
        grad.addColorStop(1, '#243b35');
        ctx.fillStyle = grad;

        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, h, 2);
        ctx.fill();
      }

      animRef.current = requestAnimationFrame(render);
    }

    render();

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {});
      }
    };
  }, [active, stream]);

  return (
    <canvas
      ref={canvasRef}
      width={220}
      height={36}
      style={{ display: 'block', margin: '0 auto' }}
      aria-hidden="true"
    />
  );
}
