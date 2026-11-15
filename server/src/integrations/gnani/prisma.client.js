import { gnaniConfig, requireGnaniKey } from './gnani.config.js';
import { readProviderError } from './gnani.errors.js';

const MODES = new Set(['verbatim', 'transcribe', 'codemix', 'transliterate']);
const LANGUAGES = new Set(['indic-auto', 'bn-IN', 'en-IN', 'gu-IN', 'hi-IN', 'kn-IN', 'ml-IN', 'mr-IN', 'pa-IN', 'ta-IN', 'te-IN']);

export async function transcribeAudio({ bytes, filename, contentType, mode = 'codemix', language = 'indic-auto', keyterms = [], signal }) {
  requireGnaniKey();
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw Object.assign(new Error('Audio file is empty or invalid.'), { code: 'INVALID_AUDIO' });
  if (!MODES.has(mode)) throw Object.assign(new Error('Unsupported transcription mode.'), { code: 'INVALID_TRANSCRIPTION_MODE' });
  const languages = String(language).split(',').map((item) => item.trim());
  if (!languages.length || languages.length > 4 || languages.some((item) => !LANGUAGES.has(item))) throw Object.assign(new Error('Unsupported language hint.'), { code: 'INVALID_LANGUAGE' });
  if (!Array.isArray(keyterms) || keyterms.length > 200) throw Object.assign(new Error('Provide at most 200 key terms.'), { code: 'INVALID_KEYTERMS' });
  const form = new FormData();
  form.set('audio_file', new Blob([bytes], { type: contentType || 'application/octet-stream' }), filename || 'audio.wav');
  form.set('model', gnaniConfig.sttModel);
  form.set('language_code', languages.join(','));
  form.set('format', mode);
  if (keyterms.length) form.set('keyterms', JSON.stringify(keyterms));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), gnaniConfig.requestTimeoutMs);
  try {
    const response = await fetch(`${gnaniConfig.baseUrl}/stt/v3`, { method: 'POST', headers: { 'X-API-Key-ID': gnaniConfig.apiKey }, body: form, signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal });
    if (!response.ok) throw await readProviderError(response);
    const result = await response.json();
    if (!result.success) throw Object.assign(new Error(result.error?.message || 'Audio transcription failed.'), { code: result.error?.type || 'GNANI_TRANSCRIPTION_FAILED' });
    return { transcript: result.transcript || '', model: result.model || gnaniConfig.sttModel, detectedLanguage: result.detected_language_code || null, requestId: result.request_id || null, processingTime: result.processing_time ?? null, endToEndLatency: result.end_to_end_latency ?? null };
  } catch (error) {
    if (error.name === 'AbortError') throw Object.assign(new Error('Gnani transcription timed out.'), { code: 'GNANI_TIMEOUT', retryable: true });
    throw error;
  } finally { clearTimeout(timeout); }
}
