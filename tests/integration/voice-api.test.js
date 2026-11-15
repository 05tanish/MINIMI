import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../server/src/app.js';

const originalVoiceFlag = process.env.ENABLE_VOICE;
afterEach(() => {
  if (originalVoiceFlag === undefined) delete process.env.ENABLE_VOICE;
  else process.env.ENABLE_VOICE = originalVoiceFlag;
});

describe('additive voice API', () => {
  it('adds a versioned health alias without requiring browser authentication', async () => {
    const response = await request(app).get('/api/v1/health');
    expect([200, 503]).toContain(response.status);
    expect(response.body.data.application).toBe('ready');
  });

  it('leaves existing auth and JSON validation behavior available on the new routes', async () => {
    const response = await request(app).post('/api/v1/voice/synthesize').send({ text: '' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_REQUEST');
  });

  it('honors the additive voice feature switch before calling Gnani', async () => {
    process.env.ENABLE_VOICE = 'false';
    const response = await request(app).post('/api/v1/voice/transcribe').set('Content-Type', 'audio/wav').send(Buffer.from('audio test'));
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('VOICE_DISABLED');
  });
});
