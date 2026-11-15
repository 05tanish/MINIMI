import { useEffect, useRef, useState } from 'react';

export default function VoiceRecorder({ onRecording, disabled }) {
  const recorder = useRef(null); const stream = useRef(null); const chunks = useRef([]); const started = useRef(0);
  const [recording, setRecording] = useState(false); const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!recording) return undefined;
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started.current) / 1000)), 250);
    return () => clearInterval(timer);
  }, [recording]);
  async function start() {
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorder.current = new MediaRecorder(stream.current);
      chunks.current = [];
      recorder.current.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
      recorder.current.onstop = () => {
        const elapsed = (Date.now() - started.current) / 1000;
        const blob = new Blob(chunks.current, { type: recorder.current?.mimeType || 'audio/webm' });
        stream.current?.getTracks().forEach((track) => track.stop()); stream.current = null;
        if (elapsed < 0.5 || blob.size < 128) {
          onRecording(null, 'Recording was too short. Please hold the mic button and speak.');
          return;
        }
        const extension = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
        onRecording(new File([blob], `recording.${extension}`, { type: blob.type }));
      };
      started.current = Date.now(); recorder.current.start(1000); setSeconds(0); setRecording(true);
    } catch { onRecording(null, 'Microphone access is unavailable. Check browser permissions or upload an audio file.'); }
  }
  function stop() { if (recorder.current?.state === 'recording') { setSeconds(Math.floor((Date.now() - started.current) / 1000)); recorder.current.stop(); setRecording(false); } }
  return <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><button type="button" disabled={disabled || !navigator.mediaDevices?.getUserMedia} onClick={recording ? stop : start}>{recording ? 'Stop recording' : 'Record voice'}</button>{recording && <span aria-live="polite">{Math.floor((Date.now() - started.current) / 1000)}s</span>}{!recording && seconds > 0 && <span>{seconds}s recorded</span>}</div>;
}
