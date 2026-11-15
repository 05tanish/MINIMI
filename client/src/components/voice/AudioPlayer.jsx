import { useEffect, useState } from 'react';
import VoicePlaybackControls from './VoicePlaybackControls.jsx';

export default function AudioPlayer({ src, base64, contentType = 'audio/wav' }) {
  const [url, setUrl] = useState(src || '');
  useEffect(() => {
    if (!base64) { setUrl(src || ''); return; }
    const binary = atob(base64); const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0)); const objectUrl = URL.createObjectURL(new Blob([bytes], { type: contentType }));
    setUrl(objectUrl); return () => URL.revokeObjectURL(objectUrl);
  }, [src, base64, contentType]);
  return url ? <VoicePlaybackControls audioUrl={url} autoPlay={false} /> : null;
}

export function SpeakAnswer({ text }) {
  const [source, setSource] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => () => { if (source.startsWith('blob:')) URL.revokeObjectURL(source); }, [source]);
  async function speak() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/v1/voice/synthesize', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, language: 'auto', voice: 'Shivani' }) });
      if (!response.ok) { const body = await response.json(); throw new Error(body.error?.message || 'Speech synthesis failed.'); }
      if (response.headers.get('content-type')?.includes('audio/')) {
        const next = URL.createObjectURL(await response.blob()); setSource(next);
      } else {
        const body = await response.json(); const jobId = body.data?.jobId;
        if (!jobId) throw new Error('Speech job was not accepted.');
        for (let attempt = 0; attempt < 120; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
          const statusResponse = await fetch(`/api/v1/audio/jobs/${encodeURIComponent(jobId)}`, { credentials: 'include' });
          const status = await statusResponse.json();
          if (!statusResponse.ok) throw new Error(status.error?.message || 'Unable to retrieve speech job status.');
          if (status.data.status === 'COMPLETED') { setSource(`/api/v1/audio/jobs/${encodeURIComponent(jobId)}/audio`); return; }
          if (['FAILED', 'CANCELLED', 'PARTIALLY_COMPLETED'].includes(status.data.status)) throw new Error('Speech generation did not complete.');
        }
        throw new Error('Speech generation is taking longer than expected.');
      }
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }
  return <div className="speak-answer" style={{ display: 'grid', gap: 6, marginTop: 8 }}><button type="button" disabled={busy} onClick={() => void speak()}>{busy ? 'Generating speech…' : source ? 'Regenerate audio' : 'Listen to answer'}</button>{error && <small role="alert">{error}</small>}{source && <VoicePlaybackControls audioUrl={source} autoPlay={false} />}</div>;
}
