import { useEffect, useRef, useState } from 'react';
import AudioWaveform from './AudioWaveform.jsx';
import VoicePlaybackControls from './VoicePlaybackControls.jsx';
import VoiceSettings from './VoiceSettings.jsx';

/* ── Research stage labels ───────────────────────────────── */
const STAGE_LABELS = {
  understanding: 'Understanding your question…',
  memory: 'Retrieving your past conversations…',
  search: 'Searching the web in background…',
  compare: 'Comparing evidence…',
  answer: 'Preparing your answer…'
};

function formatForSpeech(answer) {
  const lines = answer
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[S\d+\]/g, '')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .split('\n')
    .map((line) => {
      const heading = line.match(/^\s*#{1,6}\s+(.+)$/);
      if (heading) return `${heading[1].replace(/[*_`]/g, '')}.`;
      const bullet = line.match(/^\s*(?:[-*+]\s+|\d+[.)]\s+)(.+)$/);
      if (bullet) return `${bullet[1]}.`;
      return line;
    });

  const body = lines.join('\n')
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/gm, '')
    .replace(/\|/g, ', ')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^\s*(?:Sources|References)\s*:?\s*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return body ? `Here’s what I found. ${body}` : '';
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
  statusDetail = '',
  lastAssistantMessage = null,
  messages = [],
  findings = [],
  error = '',
  onRetry,
  onSwitchToText,
  voiceSettings = { voice: 'Shivani', language: 'indic-auto', autoPlay: true },
  onUpdateVoiceSettings
}) {
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [micStream, setMicStream] = useState(null);
  const [permissionError, setPermissionError] = useState('');
  const [transcribing, setTranscribing] = useState(false);
  const [synthesizing, setSynthesizing] = useState(false);
  const [audioUrl, setAudioUrl] = useState('');
  const [audioError, setAudioError] = useState('');
  const [browserSpeech, setBrowserSpeech] = useState(false);
  const [spokenAnswer, setSpokenAnswer] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);
  const startTimeRef = useRef(0);
  const synthesizedMessageIdRef = useRef(null);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (micStream) micStream.getTracks().forEach((t) => t.stop());
    };
  }, [micStream]);

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
    setSynthesizing(true);
    setAudioError('');
    setBrowserSpeech(false);
    setSpokenAnswer('');
    window.speechSynthesis?.cancel();
    let cleanText = formatForSpeech(text);
    try {
      const prepared = await fetch('/api/v1/voice/prepare-answer', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: text, question: lastUserMsg?.content || '' })
      });
      if (prepared.ok) {
        const body = await prepared.json();
        if (body.data?.text?.trim()) cleanText = body.data.text.trim();
      }
      setSpokenAnswer(cleanText);

      const response = await fetch('/api/v1/voice/synthesize', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: cleanText.slice(0, 4000),
          language: voiceSettings.language === 'indic-auto' ? 'auto' : voiceSettings.language,
          voice: voiceSettings.voice || 'Shivani'
        })
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error?.message || 'Voice synthesis unavailable');
      }

      if (response.headers.get('content-type')?.includes('audio/')) {
        const blob = await response.blob();
        setAudioUrl(URL.createObjectURL(blob));
      } else {
        const body = await response.json();
        const jobId = body.data?.jobId;
        if (jobId) {
          for (let attempt = 0; attempt < 60; attempt++) {
            await new Promise((r) => setTimeout(r, 2000));
            const poll = await fetch(`/api/v1/audio/jobs/${encodeURIComponent(jobId)}`, { credentials: 'include' });
            const data = await poll.json();
            if (data.data?.status === 'COMPLETED') {
              setAudioUrl(`/api/v1/audio/jobs/${encodeURIComponent(jobId)}/audio`);
              break;
            }
            if (['FAILED', 'CANCELLED'].includes(data.data?.status)) {
              throw new Error('Voice generation did not complete.');
            }
          }
        }
      }
    } catch {
      if ('speechSynthesis' in window && 'SpeechSynthesisUtterance' in window && cleanText) {
        const utterance = new SpeechSynthesisUtterance(cleanText.slice(0, 4000));
        utterance.lang = voiceSettings.language === 'indic-auto' ? 'en-IN' : voiceSettings.language;
        if (voiceSettings.autoPlay) window.speechSynthesis.speak(utterance);
        setBrowserSpeech(true);
      } else {
        setAudioError('Voice playback is unavailable. You can try playing the answer again.');
      }
    } finally {
      setSynthesizing(false);
    }
  }

  /* ── Recording ── */
  async function startRecording() {
    setPermissionError('');
    setAudioError('');
    audioChunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
      recorder.onstop = () => {
        const duration = (Date.now() - startTimeRef.current) / 1000;
        stream.getTracks().forEach((t) => t.stop());
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
      setPermissionError(
        err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError'
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
    if (timerRef.current) clearInterval(timerRef.current);
    audioChunksRef.current = [];
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
    if (micStream) { micStream.getTracks().forEach((t) => t.stop()); setMicStream(null); }
    setRecording(false);
    setRecordingSeconds(0);
  }

  /* ── Transcription via worker (ffmpeg guaranteed in Docker) ── */
  async function submitVoiceForTranscription(audioFile) {
    setTranscribing(true);
    setPermissionError('');
    try {
      const idempotencyKey = crypto.randomUUID();
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
        for (let attempt = 0; attempt < 60; attempt++) {
          await new Promise((r) => setTimeout(r, 2500));
          const poll = await fetch(`/api/v1/audio/jobs/${encodeURIComponent(jobId)}`, { credentials: 'include' });
          const pollData = await poll.json();
          const jobStatus = pollData.data?.status;
          if (jobStatus === 'COMPLETED' || jobStatus === 'PARTIALLY_COMPLETED') {
            const transcript = (pollData.data?.result?.transcript || '').trim();
            if (!transcript) throw new Error('No clear speech was recognized. Please try speaking again.');
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
      const imResponse = await fetch('/api/v1/voice/transcribe', {
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
      onSendMessage(text);
    } catch (err) {
      setPermissionError(err.message || 'Speech recognition failed. You can speak again or switch to Text Mode.');
    } finally {
      setTranscribing(false);
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
    ? 'recording'
    : transcribing
    ? 'transcribing'
    : busy
    ? 'researching'
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
        {statePhase === 'researching' && (
          <div className="voice-research-card" style={{ background: '#fff', border: '1px solid #e2e8e1', borderRadius: '20px', padding: '10px 16px', marginBottom: '16px', boxShadow: '0 4px 16px rgba(36,59,53,.06)' }}>
            <ResearchStages status={status} statusDetail={statusDetail} />
            {findings.length > 0 && (
              <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '4px', justifyContent: 'center' }}>
                {findings.map((f, i) => (
                  <span key={i} style={{ fontSize: '9px', background: '#edf3e9', color: '#567b4a', padding: '2px 7px', borderRadius: '10px', fontWeight: 600 }}>
                    {f.findingsType === 'memory' ? '📖 Memory' : f.findingsType === 'search' ? '🔍 Web' : f.findingsType === 'diff' ? '📊 Diff' : ''}
                    {f.items?.length ? ` ×${f.items.length}` : ''}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── IDLE/DONE: Show last exchange as compact card ── */}
        {statePhase === 'idle' && lastAsstMsg && (
          <div className="voice-answer-card" style={{ background: '#f5f8f4', border: '1px solid #dde7db', borderRadius: '16px', padding: '14px 16px', marginBottom: '16px' }}>
            {synthesizing ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '12px', color: '#566e5f' }}>
                <span className="spinner" /> Preparing your spoken answer…
              </div>
            ) : audioUrl ? (
              <VoicePlaybackControls audioUrl={audioUrl} autoPlay={voiceSettings.autoPlay} />
            ) : browserSpeech ? (
              <button type="button" onClick={() => {
                if (window.speechSynthesis.speaking) window.speechSynthesis.cancel();
                else {
                  const utterance = new SpeechSynthesisUtterance((spokenAnswer || formatForSpeech(lastAsstMsg.content)).slice(0, 4000));
                  utterance.lang = voiceSettings.language === 'indic-auto' ? 'en-IN' : voiceSettings.language;
                  window.speechSynthesis.speak(utterance);
                }
              }} style={{ background: '#243b35', color: '#eaffb7', border: 'none', borderRadius: '8px', padding: '8px 14px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                {window.speechSynthesis.speaking ? '⏹ Stop spoken answer' : '🔊 Replay spoken answer'}
              </button>
            ) : (
              <button type="button" onClick={() => void synthesizeResponse(lastAsstMsg.content)} style={{ background: '#243b35', color: '#eaffb7', border: 'none', borderRadius: '8px', padding: '8px 14px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                🔊 Play spoken answer
              </button>
            )}
          </div>
        )}

        {/* Audio error (non-critical) */}
        {audioError && statePhase === 'idle' && (
          <div style={{ marginBottom: '10px', fontSize: '11px', color: '#88554c', textAlign: 'center' }}>{audioError}</div>
        )}

        {/* ── Main voice card ─────────────────────────── */}
        <div
          className="voice-card"
          style={{ background: '#fff', border: '1px solid #e2e8e1', borderRadius: '24px', padding: '32px 24px', boxShadow: '0 8px 30px rgba(36,59,53,.06)', textAlign: 'center' }}
        >
          {/* Waveform */}
          <div style={{ minHeight: '44px', display: 'grid', placeItems: 'center', marginBottom: '14px' }}>
            <AudioWaveform active={recording} stream={micStream} />
          </div>

          {/* Big mic button */}
          <div style={{ position: 'relative', display: 'inline-block', margin: '6px auto' }}>
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
              {recording ? '■' : transcribing ? '…' : '🎙'}
            </button>
          </div>

          {/* State label */}
          <div style={{ marginTop: '14px', minHeight: '34px' }}>
            {statePhase === 'recording' && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <span className="dot" style={{ background: '#d94334', width: '8px', height: '8px' }} />
                <span style={{ fontWeight: 700, color: '#243b35', fontSize: '14px' }}>Listening…</span>
                <span style={{ fontSize: '13px', color: '#66776e', fontVariantNumeric: 'tabular-nums' }}>({formatTime(recordingSeconds)})</span>
              </div>
            )}
            {statePhase === 'transcribing' && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <span className="spinner" />
                <span style={{ fontSize: '13px', color: '#526659' }}>Recognizing speech with Gnani Prisma…</span>
              </div>
            )}
            {statePhase === 'researching' && (
              <span style={{ fontSize: '13px', color: '#617067' }}>
                Researching in background — you'll hear the answer when ready
              </span>
            )}
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
          {statePhase === 'recording' && (
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
            <div style={{ marginTop: '14px', padding: '10px 14px', background: '#fff0ed', border: '1px solid #f7d5ce', borderRadius: '10px', color: '#984334', fontSize: '12px', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
              <span>{permissionError}</span>
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
