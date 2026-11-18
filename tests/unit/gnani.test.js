import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

describe('isolated Gnani adapters', () => {
  it('sends the documented Prisma v3 REST fields and returns language metadata', async () => {
    vi.stubEnv('GNANI_API_KEY', 'test-key');
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, transcript: 'नमस्ते Minimi', model: 'prisma-v3.0', detected_language_code: 'hi-IN', request_id: 'r1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const { transcribeAudio } = await import('../../server/src/integrations/gnani/prisma.client.js');
    const result = await transcribeAudio({ bytes: Buffer.from('audio'), filename: 'clip.wav', contentType: 'audio/wav' });
    const request = fetch.mock.calls[0][1];
    const fields = request.body;
    expect(fetch.mock.calls[0][0]).toBe('https://api.vachana.ai/stt/v3');
    expect(request.headers['X-API-Key-ID']).toBe('test-key');
    expect(fields.get('model')).toBe('prisma-v3.0');
    expect(fields.get('language_code')).toBe('indic-auto');
    expect(fields.get('format')).toBe('codemix');
    expect(result).toMatchObject({ transcript: 'नमस्ते Minimi', detectedLanguage: 'hi-IN', requestId: 'r1' });
  });

  it('rejects an invalid transcription mode before the provider call', async () => {
    vi.stubEnv('GNANI_API_KEY', 'test-key');
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const { transcribeAudio } = await import('../../server/src/integrations/gnani/prisma.client.js');
    await expect(transcribeAudio({ bytes: Buffer.from('x'), mode: 'invented' })).rejects.toMatchObject({ code: 'INVALID_TRANSCRIPTION_MODE' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses the documented Timbre v3 model, voice, language and audio config', async () => {
    vi.stubEnv('GNANI_API_KEY', 'test-key');
    const fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/wav' } }));
    vi.stubGlobal('fetch', fetch);
    const { synthesizeSpeech } = await import('../../server/src/integrations/gnani/timbre.client.js');
    const result = await synthesizeSpeech({ text: 'नमस्ते', language: 'hi-IN', voice: 'Shivani' });
    const payload = JSON.parse(fetch.mock.calls[0][1].body);
    expect(fetch.mock.calls[0][0]).toBe('https://api.vachana.ai/api/v1/tts/inference');
    expect(payload).toMatchObject({ model: 'timbre-v3.0', voice: 'Shivani', language: 'hi-IN', speed: 1, audio_config: { container: 'wav', sample_rate: 48000 } });
    expect(result.audio).toEqual(Buffer.from([1, 2, 3]));
  });

  it('rejects unsupported Timbre v3.0 speeds before the provider call', async () => {
    vi.stubEnv('GNANI_API_KEY', 'test-key');
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const { synthesizeSpeech } = await import('../../server/src/integrations/gnani/timbre.client.js');
    await expect(synthesizeSpeech({ text: 'Hello', speed: 1.05 })).rejects.toMatchObject({ code: 'INVALID_TTS_SPEED' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not call an undocumented Evon endpoint and labels the existing provider fallback', async () => {
    vi.stubEnv('GNANI_EVON_API_KEY', 'account-key');
    vi.stubEnv('GNANI_EVON_BASE_URL', 'https://evon.example.invalid');
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const { generateWithEvonOrFallback } = await import('../../server/src/integrations/gnani/evon.client.js');
    await expect(generateWithEvonOrFallback({})).rejects.toMatchObject({ code: 'EVON_API_UNVERIFIED' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
