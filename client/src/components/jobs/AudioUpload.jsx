import { useEffect, useState } from 'react';
import AudioPlayer from '../voice/AudioPlayer.jsx';
import LanguageSelector from '../voice/LanguageSelector.jsx';
import TranscriptionPreview from '../voice/TranscriptionPreview.jsx';
import VoiceRecorder from '../voice/VoiceRecorder.jsx';
import JobProgress from './JobProgress.jsx';

const api = (url, options = {}) => fetch(url, { credentials: 'include', ...options });
const done = (status) => ['COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'CANCELLED'].includes(status);

export default function AudioUpload({ conversationId, onTranscript, onError }) {
  const [file, setFile] = useState(null); const [job, setJob] = useState(null); const [transcript, setTranscript] = useState(''); const [language, setLanguage] = useState('indic-auto'); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!job?.jobId || done(job.status)) return;
    let stopped = false; let timer;
    async function poll() {
      try {
        const response = await api(`/api/v1/audio/jobs/${encodeURIComponent(job.jobId)}`); const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message || 'Unable to retrieve audio job status.');
        if (stopped) return;
        const next = payload.data; setJob(next);
        if (done(next.status)) {
          const files = next.result?.files || [];
          const text = next.result?.transcript || files.map((item) => item.full_transcript || '').filter(Boolean).join('\n');
          setTranscript(text);
          if (next.status === 'FAILED') setError('Transcription failed. Retry with the audio file.');
          else if (next.status === 'PARTIALLY_COMPLETED') setError('Some audio sections failed. Review the partial transcript before using it.');
          return;
        }
        timer = setTimeout(poll, 3000);
      } catch (cause) { if (!stopped) { setError(cause.message); timer = setTimeout(poll, 6000); } }
    }
    timer = setTimeout(poll, 1000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [job?.jobId, job?.status]);

  async function submitAudio(selected = file) {
    if (!selected) return;
    setBusy(true); setError(''); setTranscript(''); setJob(null);
    try {
      const response = await api('/api/v1/audio/jobs', { method: 'POST', headers: { 'Content-Type': selected.type || 'application/octet-stream', 'X-Audio-Filename': selected.name, 'X-Language-Code': language === 'indic-auto' ? 'indic-auto' : language, 'X-Transcription-Mode': 'codemix', 'Idempotency-Key': crypto.randomUUID(), ...(conversationId ? { 'X-Conversation-Id': conversationId } : {}) }, body: selected });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || 'Audio upload failed.');
      setJob(payload.data);
    } catch (cause) { setError(cause.message); onError?.(cause.message); }
    finally { setBusy(false); }
  }

  return <section style={{ display: 'grid', gap: 9, padding: '12px 0', width: '100%' }} aria-label="Voice research input">
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
      <VoiceRecorder disabled={busy || Boolean(job && !done(job.status))} onRecording={(recorded, message) => { if (message) setError(message); if (recorded) { setFile(recorded); void submitAudio(recorded); } }} />
      <label style={{ fontSize: 12 }}>Upload audio <input type="file" accept="audio/*,.webm,.m4a,.mp3,.wav,.ogg,.flac" disabled={busy} onChange={(event) => { const picked = event.target.files?.[0]; if (picked) { setFile(picked); void submitAudio(picked); } }} /></label>
      <LanguageSelector value={language} onChange={setLanguage} />
    </div>
    {busy && <div role="status">Uploading audio…</div>}
    {job && <JobProgress job={job} />}
    {error && <div role="alert" style={{ color: '#a33', fontSize: 12 }}>{error}{file && job?.status === 'FAILED' && <button type="button" onClick={() => void submitAudio(file)}>Retry</button>}</div>}
    {transcript && <><TranscriptionPreview value={transcript} onChange={setTranscript} onSubmit={() => onTranscript(transcript)} disabled={busy} />{job?.result?.files?.length > 1 && <small>Transcript reconstructed from {job.result.files.length} processed audio chunks.</small>}</>}
    {job?.type === 'SYNTHESIS' && job.status === 'COMPLETED' && <AudioPlayer src={`/api/v1/audio/jobs/${encodeURIComponent(job.jobId)}/audio`} />}
  </section>;
}
