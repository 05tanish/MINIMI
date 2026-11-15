import { gnaniConfig, requireGnaniKey } from './gnani.config.js';
import { readProviderError } from './gnani.errors.js';

const LANGUAGES = new Set(['auto', 'hi-IN', 'en-IN', 'ta-IN', 'te-IN', 'kn-IN', 'ml-IN', 'mr-IN', 'pa-IN', 'bn-IN', 'gu-IN', 'hi-en']);
const V3_VOICES = new Set(['Shivani', 'Lakshmi', 'Kalpana', 'Chetana', 'Vasudha', 'Riyaa', 'Tarika', 'Avinash', 'Shubham', 'Prakash', 'Devansh', 'Yashraj', 'Harshad']);

export async function synthesizeSpeech({ text, language = 'auto', voice = gnaniConfig.ttsVoice, speed = 1, signal }) {
  requireGnaniKey();
  if (typeof text !== 'string' || !text.trim()) throw Object.assign(new Error('Text is required for speech synthesis.'), { code: 'INVALID_TTS_TEXT' });
  if (!LANGUAGES.has(language)) throw Object.assign(new Error('Unsupported synthesis language.'), { code: 'INVALID_LANGUAGE' });
  if (!V3_VOICES.has(voice)) throw Object.assign(new Error('Unsupported Timbre v3.0 voice.'), { code: 'INVALID_TTS_VOICE' });
  if (!Number.isFinite(Number(speed)) || Number(speed) < 0.85 || Number(speed) > 1.15) throw Object.assign(new Error('Speech speed must be between 0.85 and 1.15.'), { code: 'INVALID_TTS_SPEED' });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), gnaniConfig.requestTimeoutMs);
  try {
    const response = await fetch(`${gnaniConfig.baseUrl}/api/v1/tts/inference`, {
      method: 'POST', headers: { 'X-API-Key-ID': gnaniConfig.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model: gnaniConfig.ttsModel, voice, language, speed: Number(speed), audio_config: { encoding: 'linear_pcm', container: 'wav', num_channels: 1, sample_rate: 48000, sample_width: 2 } }),
      signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    });
    if (!response.ok) throw await readProviderError(response);
    return { audio: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type') || 'audio/wav', model: gnaniConfig.ttsModel, voice, language };
  } catch (error) {
    if (error.name === 'AbortError') throw Object.assign(new Error('Gnani speech synthesis timed out.'), { code: 'GNANI_TIMEOUT', retryable: true });
    throw error;
  } finally { clearTimeout(timeout); }
}
