import express from 'express';
import { z } from 'zod';

export const audioProcessingRouter = express.Router();
const workerUrl = () => process.env.WORKER_INTERNAL_URL?.replace(/\/$/, '');
const workerSecret = () => process.env.WORKER_INTERNAL_SECRET || '';
const fail = (res, status, code, message) => res.status(status).json({ success: false, data: null, error: { code, message } });
const rawAudio = (req, res, next) => express.raw({ type: ['audio/*', 'application/octet-stream'], limit: process.env.MAX_AUDIO_UPLOAD_BYTES || '100mb' })(req, res, next);

// Separate endpoint and worker queue keep this feature opt-in and preserve existing transcription behavior.
audioProcessingRouter.post('/audio/processing-jobs', rawAudio, async (req, res) => {
  if (process.env.ENABLE_BACKGROUND_JOBS === 'false') return fail(res, 503, 'BACKGROUND_JOBS_DISABLED', 'Background audio processing is disabled.');
  if (!Buffer.isBuffer(req.body) || !req.body.length) return fail(res, 400, 'INVALID_AUDIO', 'Upload an audio file as the request body.');
  if (!workerUrl() || !workerSecret()) return fail(res, 503, 'WORKER_UNAVAILABLE', 'Background audio processing is not configured.');
  const mode = z.enum(['standard', 'noise_reduced', 'multi_speaker']).safeParse(req.get('x-audio-processing-mode') || 'standard');
  const key = z.string().trim().min(8).max(120).safeParse(req.get('idempotency-key'));
  if (!mode.success) return fail(res, 400, 'INVALID_MODE', 'Mode must be standard, noise_reduced, or multi_speaker.');
  if (!key.success) return fail(res, 400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send a unique Idempotency-Key for this audio upload.');
  const form = new FormData();
  const filename = String(req.get('x-audio-filename') || 'audio.wav').replace(/[\\/\0]/g, '_').slice(0, 180);
  form.set('file', new Blob([req.body], { type: req.get('content-type') || 'application/octet-stream' }), filename);
  form.set('user_id', req.user.id);
  form.set('idempotency_key', key.data);
  form.set('mode', mode.data);
  form.set('language_code', req.get('x-language-code') || 'indic-auto');
  form.set('output_format', req.get('x-transcription-mode') || 'codemix');
  form.set('keyterms', req.get('x-keyterms') || '[]');
  try {
    const response = await fetch(`${workerUrl()}/internal/audio-processing/jobs`, { method: 'POST', headers: { 'X-Worker-Secret': workerSecret() }, body: form, signal: AbortSignal.timeout(120000) });
    const body = await response.json();
    if (!response.ok) return fail(res, response.status, 'AUDIO_PROCESSING_REJECTED', body.detail || 'Audio processing request was rejected.');
    res.status(202).json(body);
  } catch { fail(res, 503, 'WORKER_UNAVAILABLE', 'Background audio processing could not be reached.'); }
});
