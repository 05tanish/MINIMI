import { useEffect, useRef, useState } from 'react';

export default function VoicePlaybackControls({
  audioUrl = '',
  autoPlay = true,
  onFinished,
  onPlaybackChange,
  interruptKey = 0,
  title = 'AI Voice Response'
}) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;

    audio.src = audioUrl;
    audio.load();

    if (autoPlay) {
      audio.play().then(() => setPlaying(true)).catch(() => {
        // Autoplay may be restricted by browser until user gesture
        setPlaying(false);
      });
    }

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      onFinished?.();
    };
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onLoadedMetadata = () => setDuration(audio.duration || 0);

    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);

    return () => {
      audio.pause();
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
    };
  }, [audioUrl, autoPlay]);

  useEffect(() => {
    if (!interruptKey || !audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
  }, [interruptKey]);

  useEffect(() => { onPlaybackChange?.(playing, Boolean(audioRef.current?.paused && currentTime > 0)); }, [playing, currentTime, onPlaybackChange]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      audio.play().catch(() => {});
    }
  }

  function replay() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    audio.play().then(() => setPlaying(true)).catch(() => {});
  }

  function toggleMute() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !muted;
    setMuted(!muted);
  }

  function stop() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setCurrentTime(0);
  }

  function changeSpeed(value) {
    const next = Number(value);
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }

  function formatTime(secs) {
    if (!Number.isFinite(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  if (!audioUrl) return null;

  return (
    <div
      className="voice-playback-bar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '10px 14px',
        background: '#f2f6f1',
        border: '1px solid #dce6db',
        borderRadius: '12px',
        maxWidth: '520px',
        margin: '8px 0 12px'
      }}
      aria-label="Voice playback controls"
    >
      <audio ref={audioRef} preload="metadata" />

      <button
        type="button"
        onClick={togglePlay}
        className="playback-btn"
        aria-label={playing ? 'Pause response audio' : 'Play response audio'}
        style={{
          width: '32px',
          height: '32px',
          borderRadius: '50%',
          border: 'none',
          background: '#243b35',
          color: '#eaffb7',
          display: 'grid',
          placeItems: 'center',
          fontSize: '13px',
          cursor: 'pointer',
          flexShrink: 0
        }}
      >
        {playing ? '⏸' : '▶'}
      </button>

      <button
        type="button"
        onClick={replay}
        aria-label="Replay audio response"
        style={{
          background: 'transparent',
          border: '1px solid #d0dcd0',
          borderRadius: '6px',
          padding: '4px 8px',
          fontSize: '11px',
          color: '#3d4d44',
          cursor: 'pointer'
        }}
      >
        ↺ Replay
      </button>

      <button type="button" onClick={stop} aria-label="Stop response audio" className="playback-stop">Stop</button>

      <button
        type="button"
        onClick={toggleMute}
        aria-label={muted ? 'Unmute response' : 'Mute response'}
        style={{
          background: 'transparent',
          border: 'none',
          fontSize: '13px',
          color: '#55655c',
          cursor: 'pointer',
          padding: '4px'
        }}
      >
        {muted ? '🔇' : '🔊'}
      </button>

      <div className="playback-timeline">
        <input aria-label="Playback position" type="range" min="0" max={duration || 0} step="0.1" value={Math.min(currentTime, duration || 0)} onChange={(event) => { const value = Number(event.target.value); if (audioRef.current) audioRef.current.currentTime = value; setCurrentTime(value); }} />
        <span style={{ fontSize: '10px', color: '#68776f', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>
      <label className="playback-speed">Speed <select aria-label="Playback speed" value={speed} onChange={(event) => changeSpeed(event.target.value)}>{[0.75, 1, 1.25, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate}×</option>)}</select></label>
    </div>
  );
}
