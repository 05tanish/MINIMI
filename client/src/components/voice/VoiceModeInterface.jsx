import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import AudioWaveform from './AudioWaveform.jsx';
import VoicePlaybackControls from './VoicePlaybackControls.jsx';
import VoiceSettings, { normalizeTtsSpeed } from './VoiceSettings.jsx';

const VoiceOrb = lazy(() => import('./VoiceOrb.jsx'));

/* ── Research stage labels ───────────────────────────────── */
const STAGE_LABELS = {
  understanding: 'Understanding your question…',
  memory: 'Retrieving your past conversations…',
  search: 'Searching the web in background…',
  compare: 'Comparing evidence…',
  answer: 'Preparing your answer…'
};

function formatForSpeech(answer) {
  const body = answer
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[S\d+\]/g, '')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^#{1,6}\s*(?:research summary|answer|summary)\s*$/gim, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/^\s*(?:Sources|References)\s*:?\s*$/gim, '')
    .replace(/\|/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
  const concise = body.split(/(?<=[.!?।])\s+/).filter(Boolean).slice(0, 4).join(' ').slice(0, 650).trim();
  return concise ? `${concise.replace(/[\s.!?]+$/, '')}. I can go deeper on any of those if you’d like.` : '';
}

function finalizeSpokenAnswer(text) {
  const body = text
    .replace(/\[S\d+\]/g, '')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*(?:#{1,6}\s*)?(?:sources|references)\s*:?\s*[\s\S]*$/gim, '')
    .replace(/^(?:(?:short answer|answer)\s*[:.\-]\s*|certainly[,.]?\s*|sure[,.]?\s*|in summary[,.]?\s*|to summarize[,.]?\s*|here(?:'|’)s what i found[,.]?\s*|here is what i found[,.]?\s*|here(?:'|’)s the answer[,.]?\s*|here is the answer[,.]?\s*|here is the complete answer[,.]?\s*|the concise answer is[,:]?\s*)/i, '')
    .replace(/\s*(?:if you want (?:the )?full details,? switch to text mode\.?|for full details,? switch to text mode\.?|do you need more (?:detailed|in-depth) information\?? let me know\.?|would you like more (?:detailed|in-depth) information\?? let me know\.?)\s*$/i, '')
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!body) return '';
  const concise = body.split(/(?<=[.!?।])\s+/).filter(Boolean).slice(0, 5).join(' ').slice(0, 850).trim();
  return concise && !/(?:if you(?:’|'| )d like|want me to expand|happy to explain more)\.?$/i.test(concise)
    ? `${concise.replace(/[\s.!?]+$/, '')}. I can go deeper on any of those if you’d like.`
    : concise;
}

function waitForPollInterval(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Speech polling was cancelled.', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function VoiceAnswerContent({ message }) {
  if (!message?.content) return null;
  const sources = message.sources || [];
  const renderInline = (line, lineIndex) => line.split(/(\[S\d+\])/g).map((part, index) => {
    const id = /^\[S\d+\]$/.test(part) ? part.slice(1, -1) : '';
    const source = id && sources.find((item) => item.id === id);
    return source ? <a className="voice-citation" key={`${lineIndex}-${index}`} href={source.url} target="_blank" rel="noreferrer" aria-label={`Open source ${id}: ${source.title}`}>{part}</a> : <span key={`${lineIndex}-${index}`}>{part}</span>;
  });
  return <div className="voice-answer-copy">
    <div className="voice-answer-label">Minimi’s answer</div>
    <div className="voice-answer-text">{message.content.split('\n').map((line, index) => {
      if (!line.trim()) return null;
      if (line.startsWith('## ')) return <h2 key={index}>{renderInline(line.slice(3), index)}</h2>;
      if (line.startsWith('### ')) return <h3 key={index}>{renderInline(line.slice(4), index)}</h3>;
      return <p key={index}>{renderInline(line.replace(/^[-*+]\s+/, '• '), index)}</p>;
    })}</div>
    {sources.length > 0 && <div className="voice-source-list" aria-label="Answer sources">
      {sources.map((source) => <a className="voice-source-card" href={source.url} target="_blank" rel="noreferrer" key={source.id}>
        <span>{source.id}</span><div><b>{source.title || source.url}</b><small>{(() => { try { return new URL(source.url).hostname; } catch { return source.url; } })()}</small></div><i aria-hidden="true">↗</i>
      </a>)}
    </div>}
  </div>;
}

/* ── Animated research stage dots ───────────────────────── */
function ResearchStages({ status, statusDetail }) {
  const stages = ['understanding', 'memory', 'search', 'compare', 'answer'];
  const active = stages.findIndex((s) => status?.toLowerCase().includes(s.slice(0, 5)));
  return (
    <div style={{ padding: '16px 20px', textAlign: 'center' }}>
      {/* Stage pills */}
      <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '10px' }}>
        {stages.map((s, i) => {
          const done = active > i;
          const current = active === i;
          return (
            <span
              key={s}
              style={{
                padding: '3px 10px',
                borderRadius: '20px',
                fontSize: '10px',
                fontWeight: 600,
                letterSpacing: '0.3px',
                background: done ? '#e8f3e8' : current ? '#243b35' : '#f0f2f0',
                color: done ? '#3a7a3a' : current ? '#eaffb7' : '#a0aaa5',
                transition: 'all 0.3s ease'
              }}
            >
              {done ? '✓ ' : current ? '● ' : ''}{s}
            </span>
          );
        })}
      </div>
      {/* Current stage label */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
        <span className="spinner" />
        <span style={{ fontSize: '13px', color: '#243b35', fontWeight: 500 }}>
          {STAGE_LABELS[Object.keys(STAGE_LABELS).find((k) => status?.toLowerCase().includes(k.slice(0, 5)))] || status || 'Minimi is researching…'}
        </span>
      </div>
      {statusDetail && (
        <div style={{ marginTop: '4px', fontSize: '11px', color: '#7a8a82' }}>{statusDetail}</div>
      )}
    </div>
  );
}

/* ── Compact last-answer card (shown after TTS, before next question) ── */
function LastAnswerCard({ userQuestion, assistantAnswer, sources, onListen, synthesizing, audioUrl, autoPlay, voiceSettings }) {
  const [expanded, setExpanded] = useState(false);
  const shortAnswer = assistantAnswer?.slice(0, 220);
  const isTruncated = assistantAnswer?.length > 220;

  return (
    <div
      style={{
        background: '#f5f8f4',
        border: '1px solid #dde7db',
        borderRadius: '16px',
        padding: '14px 16px',
        marginBottom: '16px',
        textAlign: 'left'
      }}
    >
      {/* User question */}
      <div style={{ marginBottom: '10px' }}>
        <span style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '1px', color: '#8a9a84', textTransform: 'uppercase' }}>
          You asked
        </span>
        <div style={{ fontSize: '13px', color: '#3b4a3e', marginTop: '3px', fontStyle: 'italic' }}>
          "{userQuestion}"
        </div>
      </div>

      {/* Minimi answer */}
      <div>
        <span style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '1px', color: '#3a6e3a', textTransform: 'uppercase' }}>
          ✳ Minimi answered
        </span>
        <div style={{ fontSize: '13px', color: '#2d3c31', marginTop: '4px', lineHeight: '1.65' }}>
          {expanded ? assistantAnswer : shortAnswer}
          {isTruncated && !expanded && '…'}
        </div>
        {isTruncated && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            style={{ background: 'none', border: 'none', color: '#567b4a', fontSize: '11px', cursor: 'pointer', padding: '4px 0', fontWeight: 600 }}
          >
            {expanded ? 'Show less' : 'Read full answer'}
          </button>
        )}
      </div>

      {/* Sources */}
      {sources?.length > 0 && (
        <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {sources.slice(0, 4).map((s) => (
            <a
              key={s.id}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              style={{
                fontSize: '9px',
                color: '#567b4a',
                background: '#edf3e9',
                borderRadius: '4px',
                padding: '2px 6px',
                textDecoration: 'none',
                whiteSpace: 'nowrap'
              }}
            >
              [{s.id}] {(() => { try { return new URL(s.url).hostname; } catch { return s.title || s.url; } })()}
            </a>
          ))}
        </div>
      )}

      {/* TTS playback / synthesizing */}
      <div style={{ marginTop: '10px' }}>
        {synthesizing ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#566e5f' }}>
            <span className="spinner" />
            Generating voice response via Gnani Timbre…
          </div>
        ) : audioUrl ? (
          <VoicePlaybackControls audioUrl={audioUrl} autoPlay={autoPlay} />
        ) : (
          <button
            type="button"
            onClick={onListen}
            style={{
              background: '#243b35',
              color: '#eaffb7',
              border: 'none',
              borderRadius: '8px',
              padding: '6px 14px',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            🔊 Speak this answer
          </button>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Main VoiceModeInterface
   ═══════════════════════════════════════════════════════════ */
export default function VoiceModeInterface({
  onSendMessage,
  busy = false,
  status = '',
  stage = '',
  statusDetail = '',
  lastAssistantMessage = null,
  messages = [],
  findings = [],
  researchTimeline = [],
  onOpenConversation,
  error = '',
  onRetry,
  onSwitchToText,
  voiceSettings = { voice: 'Shivani', language: 'indic-auto', autoPlay: true, speed: 1 },
  onUpdateVoiceSettings
}) {
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [micStream, setMicStream] = useState(null);
  const [permissionError, setPermissionError] = useState('');
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [transcriptionStatus, setTranscriptionStatus] = useState('');
  const [lastTranscript, setLastTranscript] = useState('');
  const [synthesizing, setSynthesizing] = useState(false);
  const [audioUrl, setAudioUrl] = useState('');
  const [audioError, setAudioError] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const [playbackPaused, setPlaybackPaused] = useState(false);
  const [interruptKey, setInterruptKey] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [webglOrbEnabled, setWebglOrbEnabled] = useState(false);

  const mediaRecorderRef = useRef(null);
  const micStreamRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);
  const startTimeRef = useRef(0);
  const cancelledRecordingRef = useRef(false);
  const synthesizedMessageIdRef = useRef(null);
  const synthesisControllerRef = useRef(null);

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches || localStorage.getItem('minimi_reduced_motion') === 'true';
    const lowPower = (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2) || (navigator.deviceMemory && navigator.deviceMemory <= 2);
    if (reducedMotion || lowPower) return;
    const probe = document.createElement('canvas');
    let supported = false;
    try {
      const context = probe.getContext('webgl2') || probe.getContext('webgl');
      supported = Boolean(context);
      context?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch { /* the CSS orb remains available if the browser blocks WebGL */ }
    setWebglOrbEnabled(supported);
  }, []);

  // Clean up only when the interface unmounts; changing stream state must not stop recording.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRecorderRef.current?.state === 'recording') {
        cancelledRecordingRef.current = true;
        audioChunksRef.current = [];
        mediaRecorderRef.current.onstop = null;
        mediaRecorderRef.current.stop();
      }
      micStreamRef.current?.getTracks().forEach((track) => track.stop());
      synthesisControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => () => {
    if (audioUrl.startsWith('blob:')) URL.revokeObjectURL(audioUrl);
  }, [audioUrl]);

  // Auto-synthesize via Gnani Timbre whenever a new assistant message completes
  useEffect(() => {
    if (!lastAssistantMessage?.content || lastAssistantMessage.streaming) return;
    const msgKey = lastAssistantMessage.id || lastAssistantMessage.content.slice(0, 80);
    if (synthesizedMessageIdRef.current === msgKey) return;
    synthesizedMessageIdRef.current = msgKey;
    // Reset audio so the new answer plays
    setAudioUrl('');
    setAudioError('');
    void synthesizeResponse(lastAssistantMessage.content);
  }, [lastAssistantMessage]);

  async function synthesizeResponse(text) {
    if (!text) return;
    synthesisControllerRef.current?.abort();
    const controller = new AbortController();
    synthesisControllerRef.current = controller;
    setSynthesizing(true);
    setAudioError('');
    let cleanText = finalizeSpokenAnswer(formatForSpeech(text));
    try {
      const prepared = await fetch('/api/v1/voice/prepare-answer', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: text, question: lastUserMsg?.content || '' }),
        signal: controller.signal
      });
      if (prepared.ok) {
        const body = await prepared.json();
        if (body.data?.text?.trim()) cleanText = finalizeSpokenAnswer(body.data.text);
      }
      if (!cleanText) throw new Error('There is no answer text to speak.');

      const response = await fetch('/api/v1/voice/synthesize', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: cleanText.slice(0, 30000),
          language: voiceSettings.language === 'indic-auto' ? 'auto' : voiceSettings.language,
          voice: voiceSettings.voice || 'Shivani',
          speed: normalizeTtsSpeed(voiceSettings.speed)
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error?.message || 'Voice synthesis unavailable');
      }

      if (response.headers.get('content-type')?.includes('audio/')) {
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        setAudioUrl(URL.createObjectURL(blob));
      } else {
        const body = await response.json();
        const jobId = body.data?.jobId;
        if (!jobId) throw new Error('Speech job was not accepted.');
        let completed = false;
        let missingJobResponses = 0;
        const pollDeadline = Date.now() + 4 * 60 * 1000;
        while (Date.now() < pollDeadline) {
          await waitForPollInterval(2000, controller.signal);
          const pollSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]);
          const poll = await fetch(`/api/v1/audio/jobs/${encodeURIComponent(jobId)}`, { credentials: 'include', signal: pollSignal });
          const data = await poll.json().catch(() => null);
          if (!data || typeof data !== 'object') throw new Error('Speech service returned an invalid job status.');
          if (poll.status === 404 && ++missingJobResponses < 4) continue;
          if (!poll.ok) throw new Error(data.error?.message || 'Unable to check speech job status.');
          missingJobResponses = 0;
          if (data.data?.status === 'COMPLETED') {
            if (!controller.signal.aborted) setAudioUrl(`/api/v1/audio/jobs/${encodeURIComponent(jobId)}/audio`);
            completed = true;
            break;
          }
          if (['FAILED', 'CANCELLED', 'PARTIALLY_COMPLETED'].includes(data.data?.status)) {
            const category = data.data?.error?.category;
            const messages = {
              SYNTHESIS_FAILED: 'The speech provider could not generate this response.',
              CELERY_TASK_FAILED: 'The background speech worker stopped before audio was ready.'
            };
            throw new Error(messages[category] || (data.data?.status === 'CANCELLED' ? 'Speech generation was cancelled.' : 'Speech generation did not complete.'));
          }
          if (!['QUEUED', 'PROCESSING'].includes(data.data?.status)) throw new Error('Speech service returned an unknown job status.');
        }
        if (!completed) throw new Error('Speech generation is taking longer than expected.');
      }
    } catch (cause) {
      if (controller.signal.aborted) return;
      const message = cause.name === 'TimeoutError'
        ? 'Speech status checks timed out.'
        : cause.name === 'SyntaxError'
          ? 'Speech service returned an invalid response.'
        : cause.name === 'TypeError'
          ? 'Speech service could not be reached.'
          : cause.message || 'The audio service is unavailable.';
      setAudioError(`Timbre voice generation failed: ${message} Retry to hear your selected voice.`);
    } finally {
      if (synthesisControllerRef.current === controller) setSynthesizing(false);
    }
  }

  /* ── Recording ── */
  async function startRecording() {
    cancelledRecordingRef.current = false;
    setPermissionError('');
    setPermissionDenied(false);
    setAudioError('');
    setLastTranscript('');
    synthesisControllerRef.current?.abort();
    setSpeaking(false);
    setInterruptKey((key) => key + 1);
    audioChunksRef.current = [];
    let acquiredStream;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      acquiredStream = stream;
      micStreamRef.current = stream;
      setMicStream(stream);
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : '';
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => { if (e.data?.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onerror = (event) => {
        if (timerRef.current) clearInterval(timerRef.current);
        stream.getTracks().forEach((track) => track.stop());
        micStreamRef.current = null;
        setMicStream(null);
        setRecording(false);
        setPermissionError(event.error?.message || 'The browser could not capture this recording. Please try again.');
      };
      recorder.onstop = () => {
        if (cancelledRecordingRef.current) return;
        const duration = (Date.now() - startTimeRef.current) / 1000;
        stream.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;
        setMicStream(null);
        if (duration < 0.6 || audioChunksRef.current.length === 0) {
          setPermissionError('Recording was too short. Tap the microphone and speak naturally.');
          setRecording(false);
          return;
        }
        const actualType = recorder.mimeType || 'audio/webm';
        const ext = actualType.includes('mp4') ? 'm4a' : 'webm';
        const blob = new Blob(audioChunksRef.current, { type: actualType });
        void submitVoiceForTranscription(new File([blob], `voice-input.${ext}`, { type: actualType }));
      };
      startTimeRef.current = Date.now();
      recorder.start(250);
      setRecording(true);
      setRecordingSeconds(0);
      timerRef.current = setInterval(() => setRecordingSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000)), 250);
    } catch (err) {
      acquiredStream?.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
      setMicStream(null);
      const denied = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError';
      setPermissionDenied(denied);
      setPermissionError(
        denied
          ? 'Microphone permission was denied. Allow microphone access in your browser or switch to Text Mode.'
          : 'Microphone could not be accessed. Ensure your microphone is connected or switch to Text Mode.'
      );
      setRecording(false);
    }
  }

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current);
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
    setRecording(false);
  }

  function cancelRecording() {
    cancelledRecordingRef.current = true;
    if (timerRef.current) clearInterval(timerRef.current);
    audioChunksRef.current = [];
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
      setMicStream(null);
    }
    setRecording(false);
    setRecordingSeconds(0);
  }

  /* ── Transcription via worker (ffmpeg guaranteed in Docker) ── */
  async function submitVoiceForTranscription(audioFile) {
    setTranscribing(true);
    setTranscriptionStatus('Sending recording securely…');
    setPermissionError('');
    try {
      const idempotencyKey = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const bgResponse = await fetch('/api/v1/audio/jobs', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': audioFile.type || 'audio/webm',
          'X-Audio-Filename': audioFile.name,
          'X-Language-Code': voiceSettings.language || 'indic-auto',
          'X-Transcription-Mode': 'codemix',
          'Idempotency-Key': idempotencyKey
        },
        body: audioFile
      });

      if (bgResponse.ok || bgResponse.status === 202) {
        const jobBody = await bgResponse.json();
        const jobId = jobBody.data?.jobId;
        if (!jobId) throw new Error('Audio job was not accepted by the server.');
        setTranscriptionStatus('Audio received · starting speech recognition…');
        let missingJobResponses = 0;
        for (let attempt = 0; attempt < 120; attempt++) {
          await new Promise((r) => setTimeout(r, 2500));
          const poll = await fetch(`/api/v1/audio/jobs/${encodeURIComponent(jobId)}`, { credentials: 'include' });
          const pollData = await poll.json();
          if (poll.status === 404 && ++missingJobResponses < 4) continue;
          if (!poll.ok) throw new Error(pollData.error?.message || 'Unable to check speech recognition progress.');
          missingJobResponses = 0;
          const jobStatus = pollData.data?.status;
          const progress = Number(pollData.data?.progress);
          setTranscriptionStatus(jobStatus === 'QUEUED'
            ? 'Recording queued · waiting for speech recognition…'
            : Number.isFinite(progress) && progress > 0
              ? `Recognizing speech · ${Math.min(99, progress)}%`
              : 'Recognizing speech…');
          if (jobStatus === 'COMPLETED' || jobStatus === 'PARTIALLY_COMPLETED') {
            const transcript = (pollData.data?.result?.transcript || '').trim();
            if (!transcript) throw new Error('No clear speech was recognized. Please try speaking again.');
            setLastTranscript(transcript);
            onSendMessage(transcript);
            return;
          }
          if (jobStatus === 'FAILED' || jobStatus === 'CANCELLED') {
            const errCat = pollData.data?.error?.category || '';
            throw new Error(
              errCat === 'PROVIDER_UNAVAILABLE'
                ? 'Speech recognition service is temporarily unavailable. Please try again.'
                : 'Speech recognition failed. Please try speaking again or switch to Text Mode.'
            );
          }
        }
        throw new Error('Speech recognition is taking longer than expected. Please try again.');
      }

      // Fallback: immediate endpoint (host ffprobe/ffmpeg or magic-byte path)
      const bgBody = await bgResponse.json().catch(() => ({}));
      const bgCode = bgBody.error?.code;
      if (bgCode !== 'WORKER_UNAVAILABLE' && bgResponse.status !== 503) {
        throw new Error(bgBody.error?.message || 'Audio upload failed.');
      }
      setTranscriptionStatus('Using direct speech recognition…');
      const directUrl = new URL('/api/v1/voice/transcribe', window.location.origin);
      directUrl.searchParams.set('mode', 'codemix');
      directUrl.searchParams.set('language', voiceSettings.language || 'indic-auto');
      const imResponse = await fetch(directUrl, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': audioFile.type || 'audio/webm',
          'X-Audio-Filename': audioFile.name,
          'X-Language-Code': voiceSettings.language || 'indic-auto',
          'X-Transcription-Mode': 'codemix'
        },
        body: audioFile
      });
      const imBody = await imResponse.json();
      if (!imResponse.ok) {
        if (imBody.error?.code === 'AUDIO_VALIDATION_UNAVAILABLE') {
          throw new Error('Voice transcription requires the Docker worker to be running. Please start it with docker compose up.');
        }
        throw new Error(imBody.error?.message || 'Transcription failed.');
      }
      const text = (imBody.data?.transcript || '').trim();
      if (!text) throw new Error('No clear speech was recognized. Please try speaking again.');
      setLastTranscript(text);
      onSendMessage(text);
    } catch (err) {
      setPermissionError(err.message || 'Speech recognition failed. You can speak again or switch to Text Mode.');
    } finally {
      setTranscribing(false);
      setTranscriptionStatus('');
    }
  }

  function formatTime(s) {
    const min = Math.floor(s / 60);
    const sec = s % 60;
    return `${min}:${sec < 10 ? '0' : ''}${sec}`;
  }

  /* ── Derive last user question and last assistant answer ── */
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
  const lastAsstMsg = [...messages].reverse().find((m) => m.role === 'assistant' && m.content && !m.streaming);
  const isFirstVisit = messages.length === 0;

  /* ── State machine label ── */
  const statePhase = recording
    ? 'listening'
    : transcribing
    ? 'processing'
    : busy
    ? (stage === 'memory' ? 'memory' : stage === 'search' ? 'searching' : stage === 'compare' ? 'comparing' : 'researching')
    : speaking ? 'speaking'
    : playbackPaused ? 'paused'
    : (error || permissionError || audioError) ? 'error'
    : 'idle';

  return (
    <div
      className="voice-shell"
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 20px',
        overflowY: 'auto',
        minHeight: 0
      }}
    >
      <div className="voice-content">

        {/* ── Settings header ─────────────────────────── */}
        <div className="voice-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <span style={{ fontSize: '11px', color: '#68776f', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' }}>
            🎙 Voice Research
          </span>
          <button
            type="button"
            onClick={() => setShowSettings(!showSettings)}
            style={{ background: 'transparent', border: '1px solid #d8e0d7', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', color: '#49564f', cursor: 'pointer' }}
          >
            ⚙ Settings
          </button>
        </div>

        {showSettings && (
          <div className="voice-settings-panel" style={{ background: '#fff', border: '1px solid #e1e8e0', borderRadius: '10px', padding: '12px', marginBottom: '16px', textAlign: 'left' }}>
            <VoiceSettings
              language={voiceSettings.language}
              onLanguageChange={(val) => onUpdateVoiceSettings({ ...voiceSettings, language: val })}
              voice={voiceSettings.voice}
              onVoiceChange={(val) => onUpdateVoiceSettings({ ...voiceSettings, voice: val })}
              speed={voiceSettings.speed}
              onSpeedChange={(speed) => onUpdateVoiceSettings({ ...voiceSettings, speed })}
            />
          </div>
        )}

        {/* ── Error banner (from App) ─────────────────── */}
        {error && (
          <div className="voice-error" style={{ marginBottom: '12px', padding: '10px 14px', background: '#fff0ed', border: '1px solid #f7d5ce', borderRadius: '10px', color: '#984334', fontSize: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
            <span>{error}</span>
            {onRetry && <button type="button" onClick={onRetry} style={{ background: '#984334', color: '#fff', border: 'none', borderRadius: '6px', padding: '5px 11px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>Retry</button>}
          </div>
        )}

        {/* ── RESEARCHING: background stage indicator (no text streaming) ── */}
        {['researching', 'memory', 'searching', 'comparing'].includes(statePhase) && (
          <div className="voice-research-card" style={{ background: '#fff', border: '1px solid #e2e8e1', borderRadius: '20px', padding: '10px 16px', marginBottom: '16px', boxShadow: '0 4px 16px rgba(36,59,53,.06)' }}>
            <ResearchStages status={status} statusDetail={statusDetail} />
          </div>
        )}

        {lastTranscript && ['researching', 'memory', 'searching', 'comparing'].includes(statePhase) && (
          <div className="voice-transcript" aria-live="polite"><span>Recognized</span><p>{lastTranscript}</p></div>
        )}

        {messages.length > 0 && <details className="voice-transcript-panel">
          <summary><span>Conversation transcript</span><small>{messages.length} message{messages.length === 1 ? '' : 's'}</small></summary>
          <div className="voice-transcript-history" aria-label="Complete conversation transcript">
            {messages.map((message, index) => <article key={message.id || `${message.role}-${index}`} className={`transcript-message ${message.role}`}>
              <span>{message.role === 'user' ? 'You' : 'Minimi'}</span>
              <p>{message.content}{message.streaming && <span className="cursor" />}</p>
            </article>)}
          </div>
        </details>}

        {(findings.length > 0 || busy || researchTimeline.length > 0) && <details className="voice-activity-panel" open={busy}>
          <summary><span>Research activity</span><small>{busy ? (status || 'In progress') : `${findings.length || researchTimeline.length} update${(findings.length || researchTimeline.length) === 1 ? '' : 's'}`}</small></summary>
          <div className="voice-activity-list">
            {busy && <p className="activity-current"><span className="spinner" />{status || 'Preparing your answer…'}{statusDetail && <small>{statusDetail}</small>}</p>}
            {researchTimeline.map((step, index) => <div className={`voice-timeline-step ${step.status}`} key={`${step.stage}-${index}`}>
              <span aria-hidden="true">{step.status === 'failed' ? '!' : step.status === 'partial' ? '◐' : '·'}</span>
              <div><b>{step.stage === 'memory' ? 'Retrieving previous conversations' : step.stage === 'search' ? 'Searching the web' : step.stage === 'compare' ? 'Comparing evidence and preparing the answer' : step.stage === 'understanding' ? 'Understanding the question' : 'Research update'}<em>{step.status === 'failed' ? 'Failed' : step.status === 'partial' ? 'Partial result' : step.status === 'active' ? 'In progress' : 'Finished'}</em></b><small>{step.detail}</small></div>
            </div>)}
            {findings.map((item, index) => <section className="activity-finding" key={`${item.findingsType}-${index}`}>
              <b>{item.findingsType === 'memory' ? 'Past conversations retrieved' : item.findingsType === 'search' ? 'Web sources collected' : item.findingsType === 'diff' ? 'Historical comparison' : 'Research update'}</b>
              {item.summary && <p>{item.summary}</p>}
              {item.findingsType === 'memory' && item.items?.map((entry, j) => <div className="voice-memory-item" key={j}><strong>{entry.topic || 'Previous conversation'}</strong>{entry.date && <time> · {new Date(entry.date).toLocaleDateString()}</time>}{entry.snippet && <span className="memory-snippet">{entry.snippet}</span>}{entry.conversationId && onOpenConversation && <button className="memory-open" type="button" onClick={() => onOpenConversation(entry.conversationId)}>Open conversation ↗</button>}</div>)}
              {item.findingsType === 'diff' && item.items?.length > 0 && <div className="voice-diff-list">
                {item.items.map((entry, j) => <article key={j}>
                  <b>{entry.entity}{entry.attribute ? ` · ${entry.attribute}` : ''}</b>
                  <div><span>Then</span><p>{entry.historicalValue ?? 'No historical value'}</p></div>
                  <div><span>Now</span><p>{entry.currentValue ?? 'No current evidence'}</p></div>
                  <small className={`diff-status ${entry.status || ''}`}>{String(entry.status || 'comparison').replaceAll('_', ' ')}</small>
                </article>)}
              </div>}
              {item.findingsType !== 'diff' && item.items?.map((entry, j) => <p key={j}>{entry.url ? <a href={entry.url} target="_blank" rel="noreferrer">{entry.title || entry.url}</a> : entry.topic || entry.title || entry.snippet || `${item.items.length} results`}{entry.date && <time> · {new Date(entry.date).toLocaleDateString()}</time>}</p>)}
            </section>)}
          </div>
        </details>}

        {/* ── IDLE/DONE: Show last exchange as compact card ── */}
        {['idle', 'speaking', 'paused'].includes(statePhase) && lastAsstMsg && (
          <div className="voice-answer-card" style={{ background: '#f5f8f4', border: '1px solid #dde7db', borderRadius: '16px', padding: '14px 16px', marginBottom: '16px' }}>
            {synthesizing ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '12px', color: '#566e5f' }}>
                <span className="spinner" /> Preparing your spoken answer…
              </div>
            ) : audioUrl ? (
              <VoicePlaybackControls audioUrl={audioUrl} autoPlay={voiceSettings.autoPlay} interruptKey={interruptKey} onPlaybackChange={(playing, paused) => { setSpeaking(playing); setPlaybackPaused(paused); }} />
            ) : (
              <button type="button" onClick={() => void synthesizeResponse(lastAsstMsg.content)} style={{ background: '#243b35', color: '#eaffb7', border: 'none', borderRadius: '8px', padding: '8px 14px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                🔊 Play spoken answer
              </button>
            )}
          </div>
        )}

        {/* Audio error (non-critical) */}
        {audioError && ['idle', 'speaking'].includes(statePhase) && (
      <div style={{ marginBottom: '10px', fontSize: '11px', color: '#88554c', textAlign: 'center' }}>{audioError}</div>
        )}

        {/* ── Main voice card ─────────────────────────── */}
        <div
          className={`voice-card voice-card-${statePhase}`}
          onPointerMove={(event) => {
            if (event.pointerType === 'touch' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const x = (event.clientX - rect.left) / rect.width - 0.5;
            const y = (event.clientY - rect.top) / rect.height - 0.5;
            event.currentTarget.style.setProperty('--tilt-x', `${-y * 2.4}deg`);
            event.currentTarget.style.setProperty('--tilt-y', `${x * 2.8}deg`);
          }}
          onPointerLeave={(event) => { event.currentTarget.style.setProperty('--tilt-x', '0deg'); event.currentTarget.style.setProperty('--tilt-y', '0deg'); }}
          style={{ background: '#fff', border: '1px solid #e2e8e1', borderRadius: '24px', padding: '32px 24px', boxShadow: '0 8px 30px rgba(36,59,53,.06)', textAlign: 'center' }}
        >
          {/* Waveform */}
          <div style={{ minHeight: '44px', display: 'grid', placeItems: 'center', marginBottom: '14px' }}>
            <AudioWaveform active={recording || speaking} stream={recording ? micStream : null} />
          </div>

          {/* Big mic button */}
          <div className="voice-orb-stage" style={{ position: 'relative', display: 'inline-block', margin: '6px auto' }}>
            {recording && (
              <div
                className="mic-pulse"
                style={{ position: 'absolute', top: '-14px', left: '-14px', right: '-14px', bottom: '-14px', borderRadius: '50%', background: 'rgba(56,102,65,.15)', animation: 'pulse 1.4s ease-out infinite', pointerEvents: 'none' }}
              />
            )}
            <button
              type="button"
              disabled={busy || transcribing}
              onClick={recording ? stopRecording : startRecording}
              aria-label={recording ? 'Stop recording' : 'Tap to speak'}
              className="big-mic-btn"
              data-state={statePhase}
              style={{
                width: '88px',
                height: '88px',
                borderRadius: '50%',
                border: 'none',
                background: recording ? '#9b382d' : (busy || transcribing) ? '#829188' : '#243b35',
                color: '#eaffb7',
                fontSize: '34px',
                cursor: (busy || transcribing) ? 'wait' : 'pointer',
                display: 'grid',
                placeItems: 'center',
                boxShadow: recording ? '0 0 0 6px rgba(155,56,45,.2)' : '0 4px 20px rgba(36,59,53,.28)',
                transition: 'all .2s cubic-bezier(.16,1,.3,1)'
              }}
            >
              <span className="voice-orb-scene" aria-hidden="true">{webglOrbEnabled ? <Suspense fallback={<div className={`orb-css-fallback ${statePhase}`} />}><VoiceOrb state={statePhase} stream={recording ? micStream : null} /></Suspense> : <div className={`orb-css-fallback ${statePhase}`} />}</span>
              {recording && <span className="orb-stop-glyph" aria-hidden="true">■</span>}
            </button>
          </div>

          {/* State label */}
          <div style={{ marginTop: '14px', minHeight: '34px' }}>
            {statePhase === 'listening' && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <span className="dot" style={{ background: '#d94334', width: '8px', height: '8px' }} />
                <span style={{ fontWeight: 700, color: '#243b35', fontSize: '14px' }}>Listening…</span>
                <span style={{ fontSize: '13px', color: '#66776e', fontVariantNumeric: 'tabular-nums' }}>({formatTime(recordingSeconds)})</span>
              </div>
            )}
            {statePhase === 'processing' && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <span className="spinner" />
                <span style={{ fontSize: '13px', color: '#526659' }}>{transcriptionStatus || 'Recognizing speech with Gnani Prisma…'}</span>
              </div>
            )}
            {['researching', 'memory', 'searching', 'comparing'].includes(statePhase) && (
              <span style={{ fontSize: '13px', color: '#617067' }}>
                {statePhase === 'memory' ? 'Retrieving your past conversations…' : statePhase === 'searching' ? 'Searching the web…' : statePhase === 'comparing' ? 'Comparing evidence…' : 'Preparing your answer…'}
              </span>
            )}
            {statePhase === 'speaking' && <span className="voice-live-state" role="status">Speaking your answer</span>}
            {statePhase === 'paused' && <span className="voice-live-state" role="status">Response paused</span>}
            {statePhase === 'error' && <span className="voice-error-state" role="status">Something needs attention</span>}
            {statePhase === 'idle' && !lastAsstMsg && (
              <span style={{ fontSize: '13px', color: '#617067' }}>
                {isFirstVisit ? 'Tap the microphone to ask your first question' : 'Tap to ask your next question'}
              </span>
            )}
            {statePhase === 'idle' && lastAsstMsg && (
              <span style={{ fontSize: '13px', color: '#617067' }}>Tap to ask your next question</span>
            )}
          </div>

          {/* Stop / Cancel buttons while recording */}
          {statePhase === 'listening' && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginTop: '14px' }}>
              <button
                type="button"
                onClick={stopRecording}
                style={{ background: '#243b35', color: '#eaffb7', border: 'none', borderRadius: '8px', padding: '8px 18px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
              >
                Done Speaking
              </button>
              <button
                type="button"
                onClick={cancelRecording}
                style={{ background: '#f2f4f2', color: '#55655c', border: '1px solid #d4ded3', borderRadius: '8px', padding: '8px 14px', fontSize: '12px', cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          )}

          {/* Mic / permission error */}
          {permissionError && (
            <div className="voice-permission-error" role="alert" style={{ marginTop: '14px', padding: '10px 14px', background: '#fff0ed', border: '1px solid #f7d5ce', borderRadius: '10px', color: '#984334', fontSize: '12px', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
              <span><strong>{permissionDenied ? 'Microphone access denied. ' : ''}</strong>{permissionError}</span>
              <button
                type="button"
                onClick={onSwitchToText}
                style={{ background: '#984334', color: '#fff', border: 'none', borderRadius: '6px', padding: '6px 12px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                Switch to Text Mode
              </button>
            </div>
          )}
        </div>

        {/* ── Suggestion prompts (only when idle, no prior messages) ── */}
        {statePhase === 'idle' && isFirstVisit && (
          <div style={{ marginTop: '18px', textAlign: 'center' }}>
            <p style={{ fontSize: '11px', color: '#7b8a82', marginBottom: '8px' }}>Or ask one of these:</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center' }}>
              {[
                'What did I ask you last week?',
                'Has the pricing we discussed changed since?',
                'Find the latest release notes for the product we discussed'
              ].map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={busy}
                  onClick={() => onSendMessage(q)}
                  style={{ background: '#fff', border: '1px solid #e1e7e0', borderRadius: '16px', padding: '7px 13px', fontSize: '11px', color: '#44554b', cursor: 'pointer' }}
                >
                  ↗ {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Switch to Text Mode hint */}
        <div style={{ marginTop: '14px', textAlign: 'center' }}>
          <button
            type="button"
            onClick={onSwitchToText}
            style={{ background: 'none', border: 'none', fontSize: '11px', color: '#8a9a90', cursor: 'pointer', textDecoration: 'underline' }}
          >
            💬 Switch to Text Mode to read full conversation history
          </button>
        </div>
      </div>
    </div>
  );
}
