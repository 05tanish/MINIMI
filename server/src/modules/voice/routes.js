import express from 'express';
import { z } from 'zod';
import { runChat } from '../chat/service.js';
import { transcribeAudio } from '../../integrations/gnani/prisma.client.js';
import { synthesizeSpeech } from '../../integrations/gnani/timbre.client.js';
import { gnaniConfig } from '../../integrations/gnani/gnani.config.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { validateShortAudio } from '../../integrations/gnani/audio.validate.js';
import { generateSpokenAnswer } from '../../infrastructure/llm/gemini.js';

export const voiceRouter = express.Router();
const workerUrl = () => process.env.WORKER_INTERNAL_URL?.replace(/\/$/, '');
const workerSecret = () => process.env.WORKER_INTERNAL_SECRET || '';
const fail = (res, status, code, message) => res.status(status).json({ success: false, data: null, error: { code, message } });

voiceRouter.post('/chat', async (req, res, next) => {
  const parsed = z.object({ conversationId: z.string().optional(), message: z.string().trim().min(1).max(12000) }).safeParse(req.body);
  const key = z.string().trim().min(8).max(120).safeParse(req.get('idempotency-key'));
  if (!parsed.success) return fail(res, 400, 'INVALID_REQUEST', 'Provide a message of 1 to 12000 characters.');
  if (!key.success) return fail(res, 400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send a unique Idempotency-Key header for this chat turn.');
  if (!prisma) return fail(res, 503, 'DATABASE_UNAVAILABLE', 'Database is not configured.');
  res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const afterSequence = Number(req.get('x-after-sequence')) || 0;
  const send = (event) => { if (!res.writableEnded) res.write(`${event.sequence ? `id: ${event.sequence}\n` : ''}event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`); };
  try { await runChat({ ...parsed.data, idempotencyKey: key.data, userId: req.user.id, onEvent: send, afterSequence, shouldStop: () => res.destroyed }); }
  catch (error) {
    await prisma.chatTurn.updateMany({ where: { userId: req.user.id, idempotencyKey: key.data, status: 'running' }, data: { status: 'failed', errorCode: error.code ?? 'INTERNAL_ERROR' } }).catch(() => {});
    send({ type: 'error', code: error.code ?? 'INTERNAL_ERROR', message: error.message ?? 'The request failed.' });
  } finally { res.end(); }
});

voiceRouter.get('/conversations', async (req, res) => {
  if (!prisma) return fail(res, 503, 'DATABASE_UNAVAILABLE', 'Database is not configured.');
  try {
    const take = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const items = await prisma.conversation.findMany({ where: { userId: req.user.id }, orderBy: { updatedAt: 'desc' }, take, ...(req.query.cursor ? { skip: 1, cursor: { id: String(req.query.cursor) } } : {}) });
    res.json({ success: true, data: { items, nextCursor: items.length === take ? items.at(-1).id : null }, error: null });
  } catch (error) { res.status(500).json({ success: false, data: null, error: { code: 'INTERNAL_ERROR', message: 'Unable to load conversations.' } }); }
});

voiceRouter.get('/conversations/:id', async (req, res) => {
  if (!prisma) return fail(res, 503, 'DATABASE_UNAVAILABLE', 'Database is not configured.');
  try {
    const data = await prisma.conversation.findFirst({ where: { id: req.params.id, userId: req.user.id }, include: { messages: { orderBy: { createdAt: 'asc' }, include: { sources: true } } } });
    if (!data) return fail(res, 404, 'NOT_FOUND', 'Conversation was not found.');
    res.json({ success: true, data, error: null });
  } catch { fail(res, 500, 'INTERNAL_ERROR', 'Unable to load the conversation.'); }
});

voiceRouter.get('/research/:id', async (req, res) => {
  if (!prisma) return fail(res, 503, 'DATABASE_UNAVAILABLE', 'Database is not configured.');
  try {
    const turn = await prisma.chatTurn.findFirst({ where: { id: req.params.id, userId: req.user.id }, include: { assistantMessage: { include: { sources: true } } } });
    if (!turn) return fail(res, 404, 'NOT_FOUND', 'Research session was not found.');
    res.json({ success: true, data: { id: turn.id, status: turn.status, errorCode: turn.errorCode, answer: turn.assistantMessage?.content ?? null, sources: turn.assistantMessage?.sources ?? [] }, error: null });
  } catch { fail(res, 500, 'INTERNAL_ERROR', 'Unable to load the research session.'); }
});

function audioBody(req, res, next) {
  express.raw({ type: ['audio/*', 'application/octet-stream'], limit: process.env.MAX_AUDIO_UPLOAD_BYTES || '100mb' })(req, res, (error) => {
    if (error) return fail(res, error.status || 413, 'INVALID_AUDIO_UPLOAD', 'Audio upload is invalid or exceeds the configured limit.');
    if (!Buffer.isBuffer(req.body) || !req.body.length) return fail(res, 400, 'INVALID_AUDIO', 'Send the audio file as the raw request body.');
    next();
  });
}

voiceRouter.post('/voice/transcribe', audioBody, async (req, res) => {
  if (process.env.ENABLE_VOICE === 'false') return fail(res, 503, 'VOICE_DISABLED', 'Voice input is disabled.');
  try {
    const filename = String(req.get('x-audio-filename') || 'audio.wav').replace(/[\\/\0]/g, '_').slice(0, 180);
    await validateShortAudio(req.body, filename);
    const result = await transcribeAudio({ bytes: req.body, filename, contentType: req.get('content-type'), mode: req.query.mode || 'codemix', language: req.query.language || 'indic-auto', keyterms: req.query.keyterms ? String(req.query.keyterms).split(',').slice(0, 200) : [] });
    res.json({ success: true, data: result, error: null });
  } catch (error) { fail(res, error.status === 429 ? 503 : error.code === 'GNANI_NOT_CONFIGURED' || error.code === 'AUDIO_VALIDATION_UNAVAILABLE' ? 503 : error.code === 'INVALID_AUDIO' || error.code === 'INVALID_AUDIO_SIZE' || error.code === 'UNSUPPORTED_AUDIO_FORMAT' || error.code === 'AUDIO_TOO_LONG' ? 400 : 502, error.code || 'TRANSCRIPTION_FAILED', error.message || 'Transcription failed.'); }
});

voiceRouter.post('/voice/synthesize', async (req, res) => {
  if (process.env.ENABLE_TTS === 'false') return fail(res, 503, 'TTS_DISABLED', 'Speech output is disabled.');
  const parsed = z.object({ text: z.string().trim().min(1).max(30000), language: z.string().optional(), voice: z.string().optional(), speed: z.number().optional() }).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'INVALID_REQUEST', 'Provide text up to 30000 characters and valid voice settings.');
  if (parsed.data.text.length > 4000) {
    if (!workerUrl() || !workerSecret()) return fail(res, 503, 'WORKER_UNAVAILABLE', 'Long speech synthesis requires the background worker.');
    try {
      const response = await fetch(`${workerUrl()}/internal/jobs/synthesis`, { method: 'POST', headers: { 'X-Worker-Secret': workerSecret(), 'Content-Type': 'application/json' }, body: JSON.stringify({ ...parsed.data, userId: req.user.id }), signal: AbortSignal.timeout(5000) });
      const body = await response.json();
      if (!response.ok) return fail(res, response.status, 'WORKER_REJECTED', body.detail || 'Worker rejected the synthesis job.');
      return res.status(202).json(body);
    } catch { return fail(res, 503, 'WORKER_UNAVAILABLE', 'Background speech synthesis could not be reached.'); }
  }
  try {
    const result = await synthesizeSpeech(parsed.data);
    res.set({ 'Content-Type': result.contentType, 'Content-Disposition': 'inline; filename="minimi-answer.wav"', 'Cache-Control': 'private, no-store' });
    res.send(result.audio);
  } catch (error) { fail(res, error.code === 'GNANI_NOT_CONFIGURED' ? 503 : 502, error.code || 'SYNTHESIS_FAILED', error.message || 'Speech synthesis failed.'); }
});

voiceRouter.post('/voice/prepare-answer', async (req, res) => {
  const parsed = z.object({
    answer: z.string().trim().min(1).max(30000),
    question: z.string().trim().max(12000).default('')
  }).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'INVALID_REQUEST', 'Provide an answer to prepare for speech.');
  try {
    const spoken = await generateSpokenAnswer(parsed.data);
    res.json({ success: true, data: { text: spoken }, error: null });
  } catch {
    res.status(503).json({ success: false, data: null, error: { code: 'SPEECH_PREPARATION_FAILED', message: 'Unable to prepare a spoken answer.' } });
  }
});

voiceRouter.post('/voice/chat', async (req, res, next) => {
  if (process.env.ENABLE_VOICE === 'false') return fail(res, 503, 'VOICE_DISABLED', 'Voice input is disabled.');
  const parsed = z.object({ conversationId: z.string().optional(), message: z.string().trim().min(1).max(12000), speak: z.boolean().default(true), language: z.string().optional(), voice: z.string().optional() }).safeParse(req.body);
  const key = z.string().trim().min(8).max(120).safeParse(req.get('idempotency-key'));
  if (!parsed.success || !key.success) return fail(res, 400, 'INVALID_REQUEST', 'A message and Idempotency-Key are required.');
  if ((!gnaniConfig.apiKey || process.env.ENABLE_TTS === 'false') && parsed.data.speak) parsed.data.speak = false;
  const events = [];
  try {
    await runChat({ ...parsed.data, idempotencyKey: key.data, userId: req.user.id, onEvent: (event) => events.push(event), shouldStop: () => false });
    const done = events.findLast((event) => event.type === 'done');
    const failure = events.findLast((event) => event.type === 'error');
    if (!done) return fail(res, 502, failure?.code || 'CHAT_FAILED', failure?.message || 'Research did not complete.');
    let audio = null; let speechJobId = null;
    if (parsed.data.speak) {
      try {
        if (done.answer.length > 4000 && workerUrl() && workerSecret()) {
          const response = await fetch(`${workerUrl()}/internal/jobs/synthesis`, { method: 'POST', headers: { 'X-Worker-Secret': workerSecret(), 'Content-Type': 'application/json' }, body: JSON.stringify({ text: done.answer, userId: req.user.id, conversationId: done.conversationId, language: parsed.data.language || 'auto', voice: parsed.data.voice || gnaniConfig.ttsVoice }), signal: AbortSignal.timeout(5000) });
          const body = await response.json();
          if (response.ok) speechJobId = body.data?.jobId || null;
        } else if (done.answer.length <= 4000) {
          const spoken = await synthesizeSpeech({ text: done.answer, language: parsed.data.language || 'auto', voice: parsed.data.voice || gnaniConfig.ttsVoice });
          audio = { contentType: spoken.contentType, base64: spoken.audio.toString('base64') };
        }
      } catch (error) { req.log?.warn({ code: error.code || 'SYNTHESIS_FAILED' }, 'Voice response synthesis failed; returning text answer'); }
    }
    res.json({ success: true, data: { ...done, audio, speechJobId, speechUnavailable: parsed.data.speak && !audio && !speechJobId }, error: null });
  } catch (error) { next(error); }
});

voiceRouter.post('/audio/jobs', audioBody, async (req, res) => {
  if (process.env.ENABLE_BACKGROUND_JOBS === 'false') return fail(res, 503, 'BACKGROUND_JOBS_DISABLED', 'Background audio processing is disabled.');
  if (!workerUrl() || !workerSecret()) return fail(res, 503, 'WORKER_UNAVAILABLE', 'Background audio processing is not configured.');
  const form = new FormData();
  const filename = String(req.get('x-audio-filename') || 'audio.wav').replace(/[\\/\0]/g, '_').slice(0, 180);
  form.set('files', new Blob([req.body], { type: req.get('content-type') || 'application/octet-stream' }), filename);
  form.set('user_id', req.user.id);
  if (req.get('x-conversation-id')) {
    if (!prisma) return fail(res, 503, 'DATABASE_UNAVAILABLE', 'Conversation ownership could not be verified.');
    try {
      const conversation = await prisma.conversation.findFirst({ where: { id: req.get('x-conversation-id'), userId: req.user.id }, select: { id: true } });
      if (!conversation) return fail(res, 404, 'NOT_FOUND', 'Conversation was not found.');
    } catch { return fail(res, 503, 'DATABASE_UNAVAILABLE', 'Conversation ownership could not be verified.'); }
    form.set('conversation_id', req.get('x-conversation-id'));
  }
  form.set('language_code', req.get('x-language-code') || 'indic-auto');
  form.set('output_format', req.get('x-transcription-mode') || 'codemix');
  form.set('keyterms', req.get('x-keyterms') || '[]');
  const idempotencyKey = z.string().trim().min(8).max(120).safeParse(req.get('idempotency-key'));
  if (!idempotencyKey.success) return fail(res, 400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send a unique Idempotency-Key for this audio upload.');
  form.set('idempotency_key', idempotencyKey.data);
  try {
    const response = await fetch(`${workerUrl()}/internal/jobs/transcription`, { method: 'POST', headers: { 'X-Worker-Secret': workerSecret() }, body: form, signal: AbortSignal.timeout(120000) });
    const body = await response.json();
    if (!response.ok) return fail(res, response.status, body.detail ? 'WORKER_REJECTED' : 'WORKER_UNAVAILABLE', body.detail || 'Worker rejected the audio job.');
    res.status(202).json(body);
  } catch (error) { fail(res, 503, 'WORKER_UNAVAILABLE', 'Background audio processing could not be reached.'); }
});

voiceRouter.get('/audio/jobs/:jobId', async (req, res) => {
  if (!workerUrl() || !workerSecret()) return fail(res, 503, 'WORKER_UNAVAILABLE', 'Background audio processing is not configured.');
  try {
    const response = await fetch(`${workerUrl()}/internal/jobs/${encodeURIComponent(req.params.jobId)}`, { headers: { 'X-Worker-Secret': workerSecret() }, signal: AbortSignal.timeout(5000) });
    const body = await response.json();
    if (!response.ok) return fail(res, response.status, 'JOB_NOT_FOUND', 'Audio job was not found.');
    if (body.data?.userId !== req.user.id) return fail(res, 404, 'NOT_FOUND', 'Audio job was not found.');
    if (body.data?.result?.audioPath) body.data.result.audioPath = undefined;
    res.json(body);
  } catch { fail(res, 503, 'WORKER_UNAVAILABLE', 'Background audio processing could not be reached.'); }
});

voiceRouter.get('/audio/jobs/:jobId/audio', async (req, res) => {
  if (!workerUrl() || !workerSecret()) return fail(res, 503, 'WORKER_UNAVAILABLE', 'Background audio processing is not configured.');
  try {
    const existing = await fetch(`${workerUrl()}/internal/jobs/${encodeURIComponent(req.params.jobId)}`, { headers: { 'X-Worker-Secret': workerSecret() }, signal: AbortSignal.timeout(5000) });
    const job = await existing.json();
    if (!existing.ok || job.data?.userId !== req.user.id || job.data?.type !== 'SYNTHESIS') return fail(res, 404, 'NOT_FOUND', 'Audio result was not found.');
    const response = await fetch(`${workerUrl()}/internal/jobs/${encodeURIComponent(req.params.jobId)}/audio`, { headers: { 'X-Worker-Secret': workerSecret() }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) return fail(res, response.status, 'AUDIO_NOT_READY', 'Generated audio is not ready.');
    res.set({ 'Content-Type': response.headers.get('content-type') || 'audio/wav', 'Cache-Control': 'private, no-store' });
    res.send(Buffer.from(await response.arrayBuffer()));
  } catch { fail(res, 503, 'WORKER_UNAVAILABLE', 'Generated audio could not be reached.'); }
});

voiceRouter.post('/audio/jobs/:jobId/cancel', async (req, res) => {
  if (!workerUrl() || !workerSecret()) return fail(res, 503, 'WORKER_UNAVAILABLE', 'Background audio processing is not configured.');
  try {
    const existing = await fetch(`${workerUrl()}/internal/jobs/${encodeURIComponent(req.params.jobId)}`, { headers: { 'X-Worker-Secret': workerSecret() }, signal: AbortSignal.timeout(5000) });
    const job = await existing.json();
    if (!existing.ok || job.data?.userId !== req.user.id) return fail(res, 404, 'NOT_FOUND', 'Audio job was not found.');
    const response = await fetch(`${workerUrl()}/internal/jobs/${encodeURIComponent(req.params.jobId)}/cancel`, { method: 'POST', headers: { 'X-Worker-Secret': workerSecret() }, signal: AbortSignal.timeout(5000) });
    res.status(response.status).json(await response.json());
  } catch { fail(res, 503, 'WORKER_UNAVAILABLE', 'Background audio processing could not be reached.'); }
});

voiceRouter.get('/health/worker', async (_req, res) => {
  if (!workerUrl() || !workerSecret()) return fail(res, 503, 'WORKER_UNAVAILABLE', 'Background audio processing is not configured.');
  try {
    const response = await fetch(`${workerUrl()}/internal/health`, { signal: AbortSignal.timeout(3000) });
    res.status(response.ok ? 200 : 503).json(await response.json());
  } catch { fail(res, 503, 'WORKER_UNAVAILABLE', 'Background audio processing could not be reached.'); }
});
