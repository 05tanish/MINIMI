import 'dotenv/config';

export const gnaniConfig = Object.freeze({
  apiKey: (process.env.GNANI_API_KEY || process.env.GNANI_API)?.trim() || '',
  baseUrl: (process.env.GNANI_API_BASE_URL || 'https://api.vachana.ai').replace(/\/$/, ''),
  sttModel: process.env.GNANI_STT_MODEL || 'prisma-v3.0',
  ttsModel: process.env.GNANI_TTS_MODEL || 'timbre-v3.0',
  ttsVoice: process.env.GNANI_TTS_VOICE || 'Shivani',
  requestTimeoutMs: Number(process.env.GNANI_REQUEST_TIMEOUT_MS || 30000)
});

export function requireGnaniKey() {
  if (!gnaniConfig.apiKey) throw Object.assign(new Error('Gnani voice service is not configured.'), { code: 'GNANI_NOT_CONFIGURED' });
}
