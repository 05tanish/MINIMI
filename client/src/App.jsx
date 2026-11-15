import { useEffect, useRef, useState, useCallback } from 'react';
import AudioUpload from './components/jobs/AudioUpload.jsx';
import { SpeakAnswer } from './components/voice/AudioPlayer.jsx';
import InteractionModeSwitcher from './components/voice/InteractionModeSwitcher.jsx';
import VoiceModeInterface from './components/voice/VoiceModeInterface.jsx';
import VoiceSettings from './components/voice/VoiceSettings.jsx';

const stages = {
  understanding: 'Understanding your question',
  memory: 'Retrieving conversation context',
  search: 'Searching the web',
  compare: 'Comparing evidence',
  answer: 'Preparing your answer'
};

const LS_MODE_KEY = 'minimi_interaction_mode';
const LS_VOICE_KEY = 'minimi_voice_settings';

const DEFAULT_VOICE_SETTINGS = { voice: 'Shivani', language: 'indic-auto', autoPlay: true, speed: 1 };

const apiFetch = (url, options = {}) =>
  fetch(url, { credentials: 'include', ...options, headers: { ...(options.headers ?? {}) } });

async function readApiResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return response.json();
  const message = response.status === 404
    ? 'The API route was not found. Check that the frontend is connected to the deployed API.'
    : `The server returned an unexpected response (${response.status}).`;
  throw new Error(message);
}

/* ─────────────────────── Auth Screen ─────────────────────── */
function AuthScreen({ onAuthenticated }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch(`/api/auth/${mode === 'signup' ? 'signup' : 'login'}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const result = await readApiResponse(response);
      if (!response.ok) throw new Error(result.error?.message ?? 'Unable to sign in.');
      onAuthenticated(result.data.user);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand">
          <div className="mark">m</div>
          <div><b>minimi</b><small>RESEARCH</small></div>
        </div>
        <h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
        <p>Your conversation research stays private to your account.</p>
        <label>Email<input autoComplete="email" type="email" required maxLength="254" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>Password<input autoComplete={mode === 'login' ? 'current-password' : 'new-password'} type="password" required minLength="10" maxLength="128" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {error && <div className="error">{error}</div>}
        <button className="auth-submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
        <button className="auth-switch" type="button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); }}>
          {mode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in'}
        </button>
      </form>
    </main>
  );
}

function CodeBlock({ code, language = '' }) {
  const [copyState, setCopyState] = useState('Copy');
  const keywords = /^(const|let|var|function|return|async|await|export|import|from|class|new|if|else|for|while|try|catch|throw|def|print|with|as|in|not|and|or|True|False|None|public|private|static|void|int|string|type|interface|extends|implements|yield)$/;
  function highlight(line, lineIndex) {
    const pattern = /(\/\/.*$|#.*$|\/\*.*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b)/g;
    const parts = [];
    let last = 0;
    for (const match of line.matchAll(pattern)) {
      if (match.index > last) parts.push(line.slice(last, match.index));
      const token = match[0];
      const kind = /^(\/\/|#|\/\*)/.test(token) ? 'comment' : /^["'`]/.test(token) ? 'string' : /^\d/.test(token) ? 'number' : keywords.test(token) ? 'keyword' : 'identifier';
      parts.push(<span className={`code-${kind}`} key={`${lineIndex}-${match.index}`}>{token}</span>);
      last = match.index + token.length;
    }
    if (last < line.length) parts.push(line.slice(last));
    return parts;
  }
  async function copy() {
    try { await navigator.clipboard.writeText(code); setCopyState('Copied'); }
    catch { setCopyState('Copy unavailable'); }
    window.setTimeout(() => setCopyState('Copy'), 1400);
  }
  return <figure className="code-block"><figcaption><span>{language || 'CODE'}</span><button type="button" onClick={() => void copy()} aria-label="Copy code block">{copyState}</button></figcaption><pre><code>{code.split('\n').map((line, index) => <span className="code-line" key={index}>{highlight(line, index)}{'\n'}</span>)}</code></pre></figure>;
}

/* ─────────────────────── Markdown renderer ─────────────────────── */
function renderText(text, sources = []) {
  const inline = (line, keyPrefix) => line.split(/(\[S\d+\]|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, i) => {
    if (/^\[S\d+\]$/.test(part)) {
      const source = sources.find((item) => item.id === part.slice(1, -1));
      return source
        ? <a className="cite" key={`${keyPrefix}-${i}`} href={source.url} target="_blank" rel="noreferrer" aria-label={`Open source ${part.slice(1, -1)}: ${source.title}`}>{part}</a>
        : <sup className="cite" key={`${keyPrefix}-${i}`}>{part}</sup>;
    }
    if (/^`[^`]+`$/.test(part)) return <code className="inline-code" key={`${keyPrefix}-${i}`}>{part.slice(1, -1)}</code>;
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>;
    if (/^\*[^*]+\*$/.test(part)) return <em key={`${keyPrefix}-${i}`}>{part.slice(1, -1)}</em>;
    return <span key={`${keyPrefix}-${i}`}>{part}</span>;
  });
  const lines = text.split('\n');
  const output = [];
  const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
  const isTableRule = (line) => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const language = line.slice(3).trim();
      const code = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) { code.push(lines[i]); i++; }
      output.push(<CodeBlock key={`code-${i}`} code={code.join('\n')} language={language} />);
      continue;
    }
    if (i + 1 < lines.length && line.includes('|') && isTableRule(lines[i + 1])) {
      const headers = cells(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) { rows.push(cells(lines[i])); i++; }
      i--;
      output.push(<div className="answer-table-wrap" key={`table-${i}`}><table className="answer-table"><thead><tr>{headers.map((cell, j) => <th key={j}>{inline(cell, `th-${i}-${j}`)}</th>)}</tr></thead><tbody>{rows.map((row, j) => <tr key={j}>{headers.map((_, k) => <td key={k}>{inline(row[k] ?? '', `td-${i}-${j}-${k}`)}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    if (line.startsWith('## ')) output.push(<h2 key={i}>{inline(line.slice(3), i)}</h2>);
    else if (line.startsWith('### ')) output.push(<h3 key={i}>{inline(line.slice(4), i)}</h3>);
    else if (line.trim() === '---') output.push(<hr key={i} />);
    else if (/^\d+\. /.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) { items.push(lines[i].replace(/^\d+\. /, '')); i++; }
      i--;
      output.push(<ol className="answer-list" key={`ol-${i}`}>{items.map((item, j) => <li key={j}>{inline(item, `ol-${i}-${j}`)}</li>)}</ol>);
    }
    else if (/^[-*] /.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) { items.push(lines[i].slice(2)); i++; }
      i--;
      output.push(<ul className="answer-list" key={`ul-${i}`}>{items.map((item, j) => <li key={j}>{inline(item, `ul-${i}-${j}`)}</li>)}</ul>);
    }
    else output.push(line ? <p key={i}>{inline(line, i)}</p> : <br key={i} />);
  }
  return output;
}

/* ─────────────────────── Diff table ─────────────────────── */
const diffStatus = {
  changed: { label: 'CHANGED', cls: 'd-changed' },
  unchanged: { label: 'UNCHANGED', cls: 'd-unchanged' },
  new_finding: { label: 'NEW', cls: 'd-new' },
  no_current_evidence: { label: 'NO CURRENT DATA', cls: 'd-missing' }
};

function DiffTable({ entries }) {
  return (
    <div className="diff-panel">
      <div className="diff-title">EVIDENCE COMPARISON</div>
      <table className="diff-table">
        <thead><tr><th>Entity</th><th>Attribute</th><th>Historical</th><th>Current</th><th>Status</th></tr></thead>
        <tbody>
          {entries.map((e, i) => {
            const s = diffStatus[e.status] ?? { label: e.status, cls: '' };
            return <tr key={i} className={s.cls}><td>{e.entity}</td><td>{e.attribute}</td><td>{e.historicalValue ?? '—'}</td><td>{e.currentValue ?? '—'}</td><td><span className="diff-badge">{s.label}</span></td></tr>;
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ─────────────────────── Findings panel ─────────────────────── */
function SourceCard({ source, index }) {
  let domain = source.url;
  try { domain = new URL(source.url).hostname; } catch {}
  return <details className="source-preview-card">
    <summary><span className="source-id">{source.id || `S${index + 1}`}</span><span className="source-preview-heading"><b>{source.title || source.url}</b><small>{domain}{source.publishedAt && ` · Published ${new Date(source.publishedAt).toLocaleDateString()}`}</small></span><span className="source-expand-mark" aria-hidden="true">⌄</span></summary>
    <div className="source-preview-body">
      {source.snippet && <p>{source.snippet}</p>}
      {source.retrievedAt && <small>Retrieved {new Date(source.retrievedAt).toLocaleDateString()}</small>}
      <a href={source.url} target="_blank" rel="noreferrer">Open original source <span aria-hidden="true">↗</span></a>
    </div>
  </details>;
}

function ResearchTimeline({ timeline = [] }) {
  if (!timeline.length) return null;
  const labels = { understanding: 'Understanding the question', memory: 'Retrieving previous conversations', search: 'Searching the web', compare: 'Comparing evidence', answer: 'Preparing the response', research: 'Research update' };
  return <ol className="research-timeline" aria-label="Research activity timeline">
    {timeline.map((step, index) => <li className={`timeline-step ${step.status}`} key={`${step.stage}-${index}`}>
      <span className="timeline-marker" aria-hidden="true">{step.status === 'finished' ? '·' : step.status === 'failed' ? '!' : step.status === 'partial' ? '◐' : <i />}</span>
      <div><b>{labels[step.stage] || labels.research}<em>{step.status === 'finished' ? 'Finished' : step.status === 'failed' ? 'Failed' : step.status === 'partial' ? 'Partial result' : 'In progress'}</em></b>{step.detail && <p>{step.detail}</p>}{step.at && <time dateTime={step.at}>{new Date(step.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>}</div>
    </li>)}
  </ol>;
}

function FindingsPanel({ findings, timeline, onOpenConversation }) {
  const memory = findings.filter((item) => item.findingsType === 'memory');
  const research = findings.filter((item) => item.findingsType !== 'memory');
  if (!findings.length && !timeline.length) return null;
  return <section className="research-panels" aria-label="Research details">
    {memory.length > 0 && <details className="context-recalled">
      <summary><span className="context-icon" aria-hidden="true">↶</span><span><b>Context recalled</b><small>Relevant details from previous conversations</small></span><em>{memory.reduce((count, item) => count + (item.items?.length || 0), 0)}</em></summary>
      <div className="context-items">{memory.flatMap((group) => group.items || []).map((item, index) => <article className="context-item" key={`${item.conversationId}-${index}`}>
        <div><b>{item.topic || 'Previous conversation'}</b>{item.date && <time dateTime={item.date}>{new Date(item.date).toLocaleDateString()}</time>}</div>
        {item.snippet && <p>{item.snippet}</p>}
        {item.conversationId && onOpenConversation && <button type="button" onClick={() => onOpenConversation(item.conversationId)}>Open conversation <span aria-hidden="true">↗</span></button>}
      </article>)}</div>
    </details>}
    <details className="findings research-activity">
      <summary><span>Research activity</span><small>{timeline.length ? `${timeline.length} steps` : `${research.length} evidence updates`}</small></summary>
      <div className="findings-body">
        <ResearchTimeline timeline={timeline} />
        {research.map((f, i) => {
          if (f.findingsType === 'search') return <div className="finding-group" key={i}><div className="finding-label">Sources collected</div>{f.items.map((item, j) => <div className="finding-item" key={j}>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.title || item.url}</a> : item.title}{item.hasContent && <span className="finding-badge">page reviewed</span>}</div>)}</div>;
          if (f.findingsType === 'diff') return <div className="finding-group" key={i}><div className="finding-label">Historical comparison</div>{f.summary && <div className="finding-summary">{f.summary}</div>}<DiffTable entries={f.items} /></div>;
          return null;
        })}
      </div>
    </details>
  </section>;
}

function dateGroupLabel(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return 'Earlier';
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((startToday - startDate) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'Previous 7 days';
  if (days < 30) return 'Previous 30 days';
  return 'Earlier';
}

function groupConversations(items) {
  const groups = new Map();
  for (const item of items) {
    const group = dateGroupLabel(item.updatedAt || item.createdAt);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(item);
  }
  return groups;
}

function ConversationItem({ conversation, active, pinned, deleting, renaming, onOpen, onPin, onRename, onDelete }) {
  return (
    <div className={`conversation-row ${active ? 'active' : ''}`}>
      <button className="conversation" onClick={onOpen} title={conversation.title} aria-current={active ? 'page' : undefined}>{conversation.title}</button>
      <div className="conversation-actions">
        <button type="button" disabled={renaming} onClick={onRename} aria-label={`Rename ${conversation.title}`} title="Rename">✎</button>
        <button type="button" onClick={onPin} aria-label={`${pinned ? 'Unpin' : 'Pin'} ${conversation.title}`} aria-pressed={pinned} title={pinned ? 'Unpin' : 'Pin'}>{pinned ? '★' : '☆'}</button>
        <button type="button" disabled={deleting} onClick={onDelete} aria-label={`Delete ${conversation.title}`} title="Delete">{deleting ? '…' : '×'}</button>
      </div>
    </div>
  );
}

/* ─────────────────────── Main App ─────────────────────── */
export default function App() {
  const [currentUser, setCurrentUser] = useState(undefined);
  const [conversations, setConversations] = useState([]);
  const [id, setId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [deletingId, setDeletingId] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [conversationSearch, setConversationSearch] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => localStorage.getItem('minimi_reduced_motion') === 'true');
  const [pinnedIds, setPinnedIds] = useState(() => {
    try { return JSON.parse(localStorage.getItem('minimi_pinned_conversations') || '[]'); } catch { return []; }
  });
  const [copiedMessageId, setCopiedMessageId] = useState(null);
  const [conversationError, setConversationError] = useState('');
  const [input, setInput] = useState('');
  const [imageAttachments, setImageAttachments] = useState([]);
  const [imageUploading, setImageUploading] = useState(false);
  const [audioToolsOpen, setAudioToolsOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [researchStage, setResearchStage] = useState('');
  const [statusDetail, setStatusDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [findings, setFindings] = useState([]);
  const [researchTimeline, setResearchTimeline] = useState([]);

  // ── Interaction mode & voice settings state ──
  const [interactionMode, setInteractionMode] = useState('voice'); // default → voice
  const [voiceSettings, setVoiceSettings] = useState(DEFAULT_VOICE_SETTINGS);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  const abort = useRef(null);
  const bottom = useRef(null);
  const composerInput = useRef(null);
  const requestKey = useRef(null);
  const lastSequence = useRef(0);
  const imageInput = useRef(null);
  const imageAttachmentsRef = useRef([]);
  imageAttachmentsRef.current = imageAttachments;

  useEffect(() => () => imageAttachmentsRef.current.forEach((image) => URL.revokeObjectURL(image.preview)), []);

  async function addImages(fileList) {
    const files = [...fileList];
    if (imageAttachments.length + files.length > 4) { setError('Attach up to four images per message.'); return; }
    setImageUploading(true);
    setError('');
    for (const file of files) {
      const maxMb = file.type === 'application/pdf' ? 20 : 8;
      if (file.size > maxMb * 1024 * 1024) { setError(`${file.name} is larger than the ${maxMb} MB limit.`); continue; }
      const preview = URL.createObjectURL(file);
      const local = { id: crypto.randomUUID(), preview, name: file.name, uploading: true };
      setImageAttachments((current) => [...current, local]);
      try {
        const response = await apiFetch('/api/files', { method: 'POST', headers: { 'content-type': file.type, 'x-image-name': file.name }, body: file });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error?.message || 'Image upload failed.');
        setImageAttachments((current) => current.map((image) => image.id === local.id ? { ...image, uploading: false, attachment: result.data } : image));
      } catch (cause) {
        setImageAttachments((current) => current.filter((image) => image.id !== local.id));
        URL.revokeObjectURL(preview);
        setError(cause.message || 'Image upload failed.');
      }
    }
    setImageUploading(false);
  }

  function clearAttachedImages() {
    setImageAttachments((current) => { current.forEach((image) => URL.revokeObjectURL(image.preview)); return []; });
  }

  /* ── Load list & scroll ── */
  async function loadList() {
    try {
      const r = await apiFetch('/api/conversations');
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error?.message || 'Unable to load conversations.');
      setConversations(j.data.items);
      setConversationError('');
    } catch (error) { setConversationError(error.message); }
  }

  async function loadConversation(cid) {
    try {
      const r = await apiFetch(`/api/conversations/${cid}`);
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error?.message || 'Unable to load this conversation.');
      setId(cid);
      setMessages(j.data.messages.map((m) => ({
        ...m,
        sources: (m.sources ?? []).map((source, index) => ({ ...source, id: `S${index + 1}`, retrievedAt: source.retrievedAt || source.metadata?.retrievedAt })),
        diff: [],
        searchRounds: 0
      })));
      setFindings([]);
      setResearchTimeline([]);
      setError('');
      setConversationError('');
    } catch (error) { setConversationError(error.message); }
  }

  async function renameConversation(conversation) {
    const title = window.prompt('Rename conversation', conversation.title)?.trim();
    if (!title || title === conversation.title) return;
    setRenamingId(conversation.id);
    try {
      const response = await apiFetch(`/api/conversations/${conversation.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || 'Unable to rename conversation.');
      setConversations((items) => items.map((item) => item.id === conversation.id ? { ...item, title } : item));
    } catch (error) { setConversationError(error.message); }
    finally { setRenamingId(null); }
  }

  function togglePinned(conversationId) {
    setPinnedIds((current) => {
      const next = current.includes(conversationId) ? current.filter((value) => value !== conversationId) : [...current, conversationId];
      localStorage.setItem('minimi_pinned_conversations', JSON.stringify(next));
      return next;
    });
  }

  async function copyAnswer(message) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessageId(message.id || message.content.slice(0, 24));
      window.setTimeout(() => setCopiedMessageId(null), 1600);
    } catch { setError('Clipboard access is unavailable in this browser.'); }
  }

  async function shareAnswer(message) {
    try {
      if (navigator.share) await navigator.share({ title: 'Minimi research', text: message.content });
      else await navigator.clipboard.writeText(message.content);
    } catch (cause) {
      if (cause.name !== 'AbortError') setError('Unable to share this answer from your browser.');
    }
  }

  async function deleteConversation(conversation) {
    if (!window.confirm(`Delete "${conversation.title}"? Its messages, saved sources, and memory will be permanently removed.`)) return;
    setDeletingId(conversation.id);
    setError('');
    try {
      const response = await apiFetch(`/api/conversations/${conversation.id}`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? 'Unable to delete conversation.');
      setConversations((items) => items.filter((item) => item.id !== conversation.id));
      if (id === conversation.id) { setId(null); setMessages([]); setFindings([]); setResearchTimeline([]); }
    } catch (e) {
      setError(e.message);
    } finally {
      setDeletingId(null);
    }
  }

  /* ── Auth check ── */
  useEffect(() => {
    apiFetch('/api/auth/me')
      .then((r) => r.ok ? r.json() : null)
      .then((j) => setCurrentUser(j?.data?.user ?? null))
      .catch(() => setCurrentUser(null));
  }, []);

  /* ── Load conversations once authenticated ── */
  useEffect(() => { if (currentUser) loadList(); }, [currentUser]);

  /* ── Auto-scroll ── */
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, status, findings]);
  useEffect(() => {
    if (!composerInput.current) return;
    composerInput.current.style.height = 'auto';
    composerInput.current.style.height = `${Math.min(composerInput.current.scrollHeight, 180)}px`;
  }, [input]);
  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', reducedMotion);
    localStorage.setItem('minimi_reduced_motion', String(reducedMotion));
  }, [reducedMotion]);

  /* ── Load preferences: server first, localStorage fallback ── */
  function applyLocalPreferences() {
    const savedMode = localStorage.getItem(LS_MODE_KEY);
    if (savedMode === 'text' || savedMode === 'voice') setInteractionMode(savedMode);
    try { setVoiceSettings({ ...DEFAULT_VOICE_SETTINGS, ...JSON.parse(localStorage.getItem(LS_VOICE_KEY) || '{}') }); } catch {}
  }

  useEffect(() => {
    if (!currentUser) {
      // Not authenticated – use localStorage only
      applyLocalPreferences();
      setPrefsLoaded(true);
      return;
    }

    apiFetch('/api/preferences/interaction-mode')
      .then((r) => r.ok ? r.json() : null)
      .then((j) => {
        if (j?.success && j.data) {
          const { interactionMode: mode, voice, language, autoPlay } = j.data;
          let localSettings = {};
          try { localSettings = JSON.parse(localStorage.getItem(LS_VOICE_KEY) || '{}'); } catch {}
          if (mode === 'text' || mode === 'voice') setInteractionMode(mode);
          setVoiceSettings({
            ...DEFAULT_VOICE_SETTINGS,
            ...localSettings,
            voice: voice || DEFAULT_VOICE_SETTINGS.voice,
            language: language || DEFAULT_VOICE_SETTINGS.language,
            autoPlay: autoPlay ?? DEFAULT_VOICE_SETTINGS.autoPlay
          });
        } else {
          applyLocalPreferences();
        }
      })
      .catch(applyLocalPreferences)
      .finally(() => setPrefsLoaded(true));
  }, [currentUser]);

  /* ── Save mode preference (debounced via useCallback) ── */
  const saveMode = useCallback((newMode, newVoice) => {
    localStorage.setItem(LS_MODE_KEY, newMode);
    if (newVoice) localStorage.setItem(LS_VOICE_KEY, JSON.stringify(newVoice));
    if (currentUser) {
      apiFetch('/api/preferences/interaction-mode', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ interactionMode: newMode, ...(newVoice || {}) })
      }).catch(() => {});
    }
  }, [currentUser]);

  /* ── Mode switcher handler ── */
  function handleModeChange(newMode) {
    if (newMode === interactionMode) return;
    // If currently recording, the VoiceModeInterface handles its own teardown
    // before we switch; we just update state.
    setInteractionMode(newMode);
    saveMode(newMode, voiceSettings);
  }

  /* ── Voice settings update ── */
  function handleVoiceSettingsUpdate(newSettings) {
    setVoiceSettings(newSettings);
    saveMode(interactionMode, newSettings);
  }

  /* ── Core submit (shared by text composer AND voice transcript) ── */
  async function submit(event, reuseRequestKey = false, overrideMessage = '') {
    event?.preventDefault();
    if (!(overrideMessage || input.trim() || imageAttachments.length) || busy || imageUploading || imageAttachments.some((image) => !image.attachment)) return;
    if (!reuseRequestKey || !requestKey.current) {
      requestKey.current = crypto.randomUUID();
      lastSequence.current = 0;
    }
    const message = (overrideMessage || input).trim();
    const attachments = overrideMessage ? [] : imageAttachments.map(({ attachment }) => attachment).filter(Boolean);
    setInput('');
    setError('');
    setBusy(true);
    setStatus(stages.understanding);
    setResearchStage('understanding');
    setStatusDetail('');
    setFindings([]);
    setResearchTimeline([]);

    setMessages((old) => {
      const base = overrideMessage && old.at(-1)?.role === 'user' && old.at(-1)?.content === message
        ? old.slice(0, -1)
        : old;
      return [
        ...base,
        { role: 'user', content: message || 'Review the attached file(s) and answer the question about their contents.', attachments, createdAt: new Date().toISOString() },
        { role: 'assistant', content: '', sources: [], diff: [], searchRounds: 0, streaming: true }
      ];
    });

    const controller = new AbortController();
    abort.current = controller;

    try {
      const response = await apiFetch('/api/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': requestKey.current,
          'x-after-sequence': String(lastSequence.current)
        },
        body: JSON.stringify({ conversationId: id ?? undefined, message, attachments }),
        signal: controller.signal
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error?.message ?? 'Request failed');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const raw of events) {
          const eventId = raw.split('\n').find((x) => x.startsWith('id: '));
          if (eventId) lastSequence.current = Number(eventId.slice(4)) || lastSequence.current;
          const line = raw.split('\n').find((x) => x.startsWith('data: '));
          if (!line) continue;
          const event = JSON.parse(line.slice(6));

          if (event.type === 'conversation') setId(event.conversationId);
          if (event.type === 'progress') {
            setResearchStage(event.stage || '');
            setStatus(stages[event.stage] ?? 'Working');
            setStatusDetail(event.detail ?? '');
            setResearchTimeline((current) => {
              const latest = current.at(-1);
              const eventStatus = ['partial', 'failed'].includes(event.status) ? event.status : 'active';
              if (latest?.stage === event.stage) return [...current.slice(0, -1), { ...latest, detail: event.detail || latest.detail, status: ['partial', 'failed'].includes(event.status) ? event.status : latest.status }];
              return [...current.map((step) => step.status === 'active' ? { ...step, status: 'finished' } : step), { stage: event.stage || 'research', detail: event.detail || '', status: eventStatus, at: new Date().toISOString() }];
            });
          }
          if (event.type === 'findings') setFindings((old) => [...old, event]);
          if (event.type === 'delta') setMessages((old) => old.map((m, i) => i === old.length - 1 ? { ...m, content: m.content + event.text } : m));
          if (event.type === 'done') {
            clearAttachedImages();
            setResearchTimeline((current) => current.map((step) => step.status === 'active' ? { ...step, status: 'finished' } : step));
            requestKey.current = null;
            lastSequence.current = 0;
            setMessages((old) => old.map((m, i) => i === old.length - 1
              ? { ...m, content: event.answer, sources: event.sources, diff: event.diff ?? [], diffSummary: event.diffSummary, searchRounds: event.searchRounds ?? 0, createdAt: new Date().toISOString(), streaming: false }
              : m
            ));
          }
          if (event.type === 'error') {
            setResearchTimeline((current) => current.map((step) => step.status === 'active' ? { ...step, status: 'failed', detail: event.message || step.detail } : step));
            throw new Error(event.message);
          }
        }
      }

      setStatus('');
      setStatusDetail('');
      setResearchStage('');
      await loadList();
    } catch (e) {
      setError(e.name === 'AbortError' ? 'Request cancelled.' : e.message);
      setResearchTimeline((current) => current.map((step) => step.status === 'active' ? { ...step, status: 'failed', detail: e.message || step.detail } : step));
      setMessages((old) => {
        const next = old.filter((m) => !m.streaming);
        if (!overrideMessage && next.at(-1)?.role === 'user' && next.at(-1)?.content === (message || 'Review the attached file(s) and answer the question about their contents.')) next.pop();
        return next;
      });
      if (!overrideMessage) setInput((current) => current || message);
    } finally {
      setBusy(false);
      setStatus('');
      setStatusDetail('');
      setResearchStage('');
      abort.current = null;
    }
  }

  /* ── Last assistant message for VoiceModeInterface auto-TTS ── */
  const lastAssistantMessage = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return messages[i];
    }
    return null;
  })();

  const visibleConversations = conversations.filter((conversation) => conversation.title.toLowerCase().includes(conversationSearch.trim().toLowerCase()));
  const pinnedConversations = visibleConversations.filter((conversation) => pinnedIds.includes(conversation.id));
  const recentConversations = visibleConversations.filter((conversation) => !pinnedIds.includes(conversation.id));
  const recentGroups = groupConversations(recentConversations);

  /* ── Loading state ── */
  if (currentUser === undefined) {
    return <main className="auth-shell"><div className="auth-card">Checking your session…</div></main>;
  }
  if (!currentUser) return <AuthScreen onAuthenticated={setCurrentUser} />;

  /* ── Main layout ── */
  return (
    <div className={`shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-brand-row">
        <div className="brand">
          <div className="mark">m</div>
          <div><b>minimi</b><small>RESEARCH</small></div>
        </div>
        <button type="button" className="sidebar-collapse" onClick={() => setSidebarCollapsed(true)} aria-label="Collapse sidebar">‹</button>
        </div>
        <button className="new-chat" onClick={() => { setId(null); setMessages([]); setFindings([]); setResearchTimeline([]); setError(''); setConversationError(''); clearAttachedImages(); setInput(''); }}>
          ＋ <span>New conversation</span>
        </button>
        <label className="conversation-search">
          <span aria-hidden="true">⌕</span>
          <input value={conversationSearch} onChange={(event) => setConversationSearch(event.target.value)} placeholder="Search conversations" aria-label="Search conversations" />
        </label>
        <nav className="conversation-list" aria-label="Conversation history">
          {pinnedConversations.length > 0 && <div className="side-label">PINNED</div>}
          {pinnedConversations.map((conversation) => <ConversationItem key={conversation.id} conversation={conversation} active={id === conversation.id} pinned deleting={deletingId === conversation.id} renaming={renamingId === conversation.id} onOpen={() => void loadConversation(conversation.id)} onPin={() => togglePinned(conversation.id)} onRename={() => void renameConversation(conversation)} onDelete={() => void deleteConversation(conversation)} />)}
          {recentGroups.size > 0 && <div className="side-label">RECENT</div>}
          {[...recentGroups.entries()].map(([group, items]) => (
            <section className="conversation-group" key={group}>
              <h2>{group}</h2>
              {items.map((conversation) => <ConversationItem key={conversation.id} conversation={conversation} active={id === conversation.id} pinned={false} deleting={deletingId === conversation.id} renaming={renamingId === conversation.id} onOpen={() => void loadConversation(conversation.id)} onPin={() => togglePinned(conversation.id)} onRename={() => void renameConversation(conversation)} onDelete={() => void deleteConversation(conversation)} />)}
            </section>
          ))}
          {!visibleConversations.length && <div className="conversation-empty">{conversationSearch ? 'No conversations match.' : 'Your conversations will appear here.'}</div>}
          {conversationError && <div className="conversation-error" role="alert">{conversationError}<button type="button" onClick={() => void loadList()}>Retry</button></div>}
        </nav>
        {settingsOpen && (
          <section className="sidebar-settings" aria-label="Settings">
            <div className="settings-heading"><strong>Voice & accessibility</strong><button type="button" onClick={() => setSettingsOpen(false)} aria-label="Close settings">×</button></div>
            <VoiceSettings
              language={voiceSettings.language}
              onLanguageChange={(language) => handleVoiceSettingsUpdate({ ...voiceSettings, language })}
              voice={voiceSettings.voice}
              onVoiceChange={(voice) => handleVoiceSettingsUpdate({ ...voiceSettings, voice })}
              speed={voiceSettings.speed}
              onSpeedChange={(speed) => handleVoiceSettingsUpdate({ ...voiceSettings, speed })}
            />
            <label className="autoplay-setting"><input type="checkbox" checked={voiceSettings.autoPlay} onChange={(event) => handleVoiceSettingsUpdate({ ...voiceSettings, autoPlay: event.target.checked })} /> Speak answers automatically</label>
            <label className="autoplay-setting"><input type="checkbox" checked={reducedMotion} onChange={(event) => setReducedMotion(event.target.checked)} /> Reduce motion</label>
          </section>
        )}
        <div className="side-footer">
          <span className="dot" /> <span className="account-email">{currentUser.email}</span>
          <button className="settings-toggle" type="button" onClick={() => setSettingsOpen((open) => !open)} aria-expanded={settingsOpen}>⚙ <span>Settings</span></button>
          <button className="auth-switch" onClick={async () => {
            await apiFetch('/api/auth/logout', { method: 'POST' });
            setCurrentUser(null);
            setConversations([]);
            setMessages([]);
            setId(null);
          }}>Sign out</button>
        </div>
      </aside>
      {!sidebarCollapsed && <button className="sidebar-overlay" type="button" aria-label="Close sidebar" onClick={() => setSidebarCollapsed(true)} />}

      {/* Main content */}
      <main className="main">
        {/* Top bar with mode switcher */}
        <header className="topbar">
          <button className="sidebar-expand" type="button" onClick={() => setSidebarCollapsed((collapsed) => !collapsed)} aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>☰</button>
          <div className="mobile-brand">minimi <span>research</span></div>
          {prefsLoaded && (
            <InteractionModeSwitcher
              mode={interactionMode}
              onModeChange={handleModeChange}
              disabled={busy}
            />
          )}
          <button className="header-settings" type="button" onClick={() => { setSettingsOpen(true); setSidebarCollapsed(false); }} aria-label="Open settings" title="Settings">⚙</button>
          <span className="connection"><i /> Private workspace</span>
        </header>

        {/* ══════════════ VOICE MODE ══════════════ */}
        {interactionMode === 'voice' && prefsLoaded && (
          <div className="voice-mode-wrapper">
            {/* Voice interaction surface */}
            <VoiceModeInterface
              onSendMessage={(text) => void submit(undefined, false, text)}
              busy={busy}
              status={status}
              stage={researchStage}
              statusDetail={statusDetail}
              findings={findings}
              researchTimeline={researchTimeline}
              lastAssistantMessage={lastAssistantMessage}
              messages={messages}
              error={error}
              onRetry={() => { const prev = messages.filter((m) => m.role === 'user').at(-1)?.content ?? ''; setError(''); void submit(undefined, true, prev); }}
              onSwitchToText={() => handleModeChange('text')}
              voiceSettings={voiceSettings}
              onUpdateVoiceSettings={handleVoiceSettingsUpdate}
              onOpenConversation={(conversationId) => void loadConversation(conversationId)}
            />
          </div>
        )}

        {/* ══════════════ TEXT MODE ══════════════ */}
        {interactionMode === 'text' && prefsLoaded && (
          <>
            <section className="thread">
              {messages.length === 0 ? (
                <div className="welcome">
                  <div className="welcome-icon">✳</div>
                  <p className="eyebrow">YOUR CONVERSATION, WITH CONTEXT</p>
                  <h1>Research that remembers<br />what matters.</h1>
                  <p className="subhead">Ask about past discussions, get current answers, and see how the evidence changed.</p>
                  <div className="suggestions">
                    {[
                      'What did I ask you last week?',
                      'Has the pricing we discussed changed?',
                      'Find the latest product release notes',
                      'Compare current information with our previous discussion',
                      'Continue my previous research'
                    ].map((question) => <button key={question} type="button" disabled={busy} onClick={() => void submit(undefined, false, question)}><span aria-hidden="true">↗</span>{question}</button>)}
                  </div>
                  {conversations.length > 0 && <div className="welcome-history"><span>Pick up where you left off</span>{conversations.slice(0, 3).map((conversation) => <button type="button" key={conversation.id} onClick={() => void loadConversation(conversation.id)}>{conversation.title}<span aria-hidden="true">→</span></button>)}</div>}
                </div>
              ) : (
                <div className="messages">
                  {messages.map((m, i) => (
                    <article className={`message ${m.role}`} key={i}>
                      <div className="avatar">{m.role === 'user' ? 'Y' : '✳'}</div>
                      <div className="bubble">
                        <div className="role-label">{m.role === 'user' ? 'YOU' : 'MINIMI'}</div>
                        {m.role === 'user' && m.attachments?.length > 0 && <div className="message-images">{m.attachments.map((file) => file.mimeType === 'application/pdf' ? <a className="message-file" key={file.publicId} href={file.secureUrl} target="_blank" rel="noreferrer"><span aria-hidden="true">PDF</span><b>{file.name || 'Attached PDF'}</b><small>Open document ↗</small></a> : <a key={file.publicId} href={file.secureUrl} target="_blank" rel="noreferrer"><img src={file.secureUrl} alt={file.name || 'Attached image'} loading="lazy" /></a>)}</div>}
                        <div className="content">{renderText(m.content, m.sources)}{m.streaming && <span className="cursor" />}</div>
                        {!m.streaming && m.createdAt && <time className="message-time" dateTime={m.createdAt}>{new Date(m.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>}
                        {/* Optional "Listen" button in text mode — uses Gnani Timbre */}
                        {m.role === 'assistant' && !m.streaming && m.content && <SpeakAnswer text={m.content} />}
                        {m.role === 'assistant' && !m.streaming && m.content && (
                          <div className="message-actions">
                            <button type="button" onClick={() => void copyAnswer(m)} aria-label="Copy answer">{copiedMessageId === (m.id || m.content.slice(0, 24)) ? 'Copied' : 'Copy'}</button>
                            {typeof navigator.share === 'function' && <button type="button" onClick={() => void shareAnswer(m)} aria-label="Share answer">Share</button>}
                            {i === messages.length - 1 && <button type="button" disabled={busy} onClick={() => { const previous = messages.slice(0, i).reverse().find((item) => item.role === 'user')?.content; if (previous) void submit(undefined, false, previous); }}>Regenerate</button>}
                          </div>
                        )}
                        {m.diff?.length > 0 && <DiffTable entries={m.diff} />}
                        {m.sources?.length > 0 && (
                          <div className="sources">
                            <div className="sources-title">SOURCES{m.searchRounds > 1 && <span className="rounds-badge">· {m.searchRounds} search rounds</span>}</div>
                            {m.sources.map((s, sourceIndex) => <SourceCard key={s.id || s.url} source={s} index={sourceIndex} />)}
                          </div>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
              {status && <div className="progress"><span className="spinner" />{status}{statusDetail && <span className="progress-detail">{statusDetail}</span>}</div>}
              {(busy || findings.length > 0 || researchTimeline.length > 0) && <FindingsPanel findings={findings} timeline={researchTimeline} onOpenConversation={(conversationId) => void loadConversation(conversationId)} />}
              {error && (
                <div className="error">
                  <span>{error}</span>
                  <button onClick={() => { const prev = input.trim() || messages.filter((m) => m.role === 'user').at(-1)?.content || ''; setError(''); void submit(undefined, true, prev); }}>Retry</button>
                </div>
              )}
              <div ref={bottom} />
            </section>

            {/* Text composer */}
            <form className={`composer ${input ? 'has-input' : ''}`} onSubmit={submit}>
              {audioToolsOpen && <div className="composer-tools"><AudioUpload conversationId={id} onTranscript={(text) => { setInput(text); setAudioToolsOpen(false); }} onError={setError} /></div>}
              {imageAttachments.length > 0 && <div className="composer-images">{imageAttachments.map((image) => <div className="composer-image" key={image.id}>{image.attachment?.mimeType === 'application/pdf' ? <span className="pdf-icon" aria-hidden="true">PDF</span> : <img src={image.preview} alt={image.name} />}<span>{image.uploading ? 'Uploading…' : image.name}</span><button type="button" disabled={image.uploading || busy} onClick={() => { URL.revokeObjectURL(image.preview); setImageAttachments((items) => items.filter((item) => item.id !== image.id)); }} aria-label={`Remove ${image.name}`}>×</button></div>)}</div>}
              <div className="composer-input-row">
                <button className="composer-attach" type="button" onClick={() => setAudioToolsOpen((open) => !open)} aria-expanded={audioToolsOpen} aria-label={audioToolsOpen ? 'Close audio input tools' : 'Add audio or record a voice question'} title="Add audio or record voice">{audioToolsOpen ? '×' : '+'}</button>
                <input ref={imageInput} className="image-file-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,.pdf" multiple hidden onChange={(event) => { if (event.target.files?.length) void addImages(event.target.files); event.target.value = ''; }} />
                <button className="composer-image-button" type="button" onClick={() => imageInput.current?.click()} disabled={busy || imageUploading || imageAttachments.length >= 4} aria-label="Attach images or PDF documents" title="Attach images or PDFs">▧</button>
                <textarea
                  ref={composerInput}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(e); } }}
                  placeholder="Ask Minimi to research or remember…"
                  rows="1"
                  aria-label="Message Minimi"
                />
              </div>
              <div className="composer-bottom">
                <span className="research-mode-indicator"><i aria-hidden="true" /> Context & web research</span>
                <span className="composer-shortcut">Enter to send · Shift + Enter for a new line</span>
                <button type="submit" disabled={busy || imageUploading || !(input.trim() || imageAttachments.length)} aria-label={busy ? 'Research in progress' : 'Send message'}>{busy || imageUploading ? <span className="spinner" /> : '↑'}</button>
              </div>
            </form>

            <footer className="disclaimer">Answers are grounded in retrieved conversations and cited web sources.</footer>
          </>
        )}
      </main>
    </div>
  );
}
