import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { voiceRouter } from '../../server/src/modules/voice/routes.js';

const originalUrl = process.env.WORKER_INTERNAL_URL;
const originalSecret = process.env.WORKER_INTERNAL_SECRET;
const originalTts = process.env.ENABLE_TTS;
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { id: 'user_1' }; req.log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }; next(); });
app.use('/api/v1', voiceRouter);

const jsonResponse = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const job = (overrides = {}) => ({ success: true, data: { jobId: 'job_abc123', userId: 'user_1', type: 'SYNTHESIS', status: 'QUEUED', progress: 0, ...overrides }, error: null });

beforeEach(() => {
  process.env.WORKER_INTERNAL_URL = 'http://worker.internal';
  process.env.WORKER_INTERNAL_SECRET = 'test-worker-secret';
  delete process.env.ENABLE_TTS;
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (originalUrl === undefined) delete process.env.WORKER_INTERNAL_URL; else process.env.WORKER_INTERNAL_URL = originalUrl;
  if (originalSecret === undefined) delete process.env.WORKER_INTERNAL_SECRET; else process.env.WORKER_INTERNAL_SECRET = originalSecret;
  if (originalTts === undefined) delete process.env.ENABLE_TTS; else process.env.ENABLE_TTS = originalTts;
});

describe('worker synthesis routes', () => {
  it('does not expose a worker transcription endpoint 404 as a missing job', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(404, { detail: 'Job not found' })));
    const response = await request(app)
      .post('/api/v1/audio/jobs')
      .set('Content-Type', 'audio/webm')
      .set('Idempotency-Key', 'voice-upload-123')
      .send(Buffer.from('audio'));
    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe('WORKER_ENDPOINT_NOT_FOUND');
    expect(response.body.error.message).not.toContain('Job not found');
  });

  it('returns the worker job ID unchanged for long speech', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse(202, job()));
    vi.stubGlobal('fetch', fetch);
    const response = await request(app).post('/api/v1/voice/synthesize').send({ text: 'a'.repeat(4001), speed: 1 });
    expect(response.status).toBe(202);
    expect(response.body.data.jobId).toBe('job_abc123');
    expect(fetch.mock.calls[0][0]).toBe('http://worker.internal/internal/jobs/synthesis');
    expect(JSON.parse(fetch.mock.calls[0][1].body).text).toHaveLength(4001);
  });

  it.each([
    [404, 'JOB_NOT_FOUND'],
    [401, 'WORKER_AUTH_FAILED'],
    [403, 'WORKER_AUTH_FAILED'],
    [500, 'WORKER_ERROR']
  ])('classifies worker polling HTTP %i without calling it a missing job', async (status, code) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(status, { detail: 'private worker diagnostic' })));
    const response = await request(app).get('/api/v1/audio/jobs/job_abc123');
    expect(response.body.error.code).toBe(code);
    expect(response.body.error.message).not.toContain('private worker diagnostic');
  });

  it('reports Redis or worker failures separately from a missing job', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(503, { detail: 'Redis unavailable' })));
    const response = await request(app).get('/api/v1/audio/jobs/job_abc123');
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('WORKER_ERROR');
  });

  it('does not call a missing synthesis endpoint a missing job', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(404, { detail: 'Not Found' })));
    const response = await request(app).post('/api/v1/voice/synthesize').send({ text: 'a'.repeat(4001) });
    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe('WORKER_ENDPOINT_NOT_FOUND');
  });

  it('normalizes legacy in-range speeds to a provider-supported value', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse(202, job())); vi.stubGlobal('fetch', fetch);
    const response = await request(app).post('/api/v1/voice/synthesize').send({ text: 'a'.repeat(4001), speed: 1.05 });
    expect(response.status).toBe(202);
    expect(JSON.parse(fetch.mock.calls[0][1].body).speed).toBe(1);
  });

  it('rejects malformed worker job responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { success: true, data: { jobId: 'wrong', userId: 'user_1', status: 'QUEUED' } })));
    const response = await request(app).get('/api/v1/audio/jobs/job_abc123');
    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe('INVALID_WORKER_RESPONSE');
  });

  it('classifies worker timeouts distinctly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Object.assign(new Error('timeout'), { name: 'TimeoutError' })));
    const response = await request(app).get('/api/v1/audio/jobs/job_abc123');
    expect(response.status).toBe(504);
    expect(response.body.error.code).toBe('WORKER_TIMEOUT');
  });

  it('requires ownership and retrieves completed audio through the same job ID', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, job({ status: 'COMPLETED' })))
      .mockResolvedValueOnce(new Response(Buffer.from('RIFF0000WAVE'), { status: 200, headers: { 'Content-Type': 'audio/wav' } }));
    vi.stubGlobal('fetch', fetch);
    const response = await request(app).get('/api/v1/audio/jobs/job_abc123/audio');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('audio/wav');
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'http://worker.internal/internal/jobs/job_abc123',
      'http://worker.internal/internal/jobs/job_abc123/audio'
    ]);
  });

  it('rejects empty or non-audio worker responses safely', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, job({ status: 'COMPLETED' })))
      .mockResolvedValueOnce(new Response('{"error":"invalid"}', { status: 200, headers: { 'Content-Type': 'application/json' } })));
    const response = await request(app).get('/api/v1/audio/jobs/job_abc123/audio');
    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe('INVALID_AUDIO_RESPONSE');
    expect(response.body.error.message).not.toContain('{"error":"invalid"}');
  });

  it('maps audio retrieval timeouts to the same safe timeout response', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, job({ status: 'COMPLETED' })))
      .mockRejectedValueOnce(Object.assign(new Error('timeout'), { name: 'TimeoutError' })));
    const response = await request(app).get('/api/v1/audio/jobs/job_abc123/audio');
    expect(response.status).toBe(504);
    expect(response.body.error.code).toBe('WORKER_TIMEOUT');
  });
});
