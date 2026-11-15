import { generateAnswer } from '../../infrastructure/llm/gemini.js';

const evonConfig = Object.freeze({ apiKey: process.env.GNANI_EVON_API_KEY?.trim() || '', baseUrl: process.env.GNANI_EVON_BASE_URL?.trim() || '', model: process.env.GNANI_EVON_MODEL || 'evon-v3.3', fallback: process.env.GNANI_EVON_FALLBACK || 'existing' });

// No hosted Evon inference endpoint/schema is published in the provider API docs.
// This adapter deliberately stays unavailable until an account-specific contract is configured.
export async function generateWithEvonOrFallback(input) {
  if (evonConfig.apiKey && evonConfig.baseUrl) {
    throw Object.assign(new Error('Evon endpoint schema has not been verified; refusing to send an undocumented request.'), { code: 'EVON_API_UNVERIFIED' });
  }
  const answer = await generateAnswer(input);
  return { answer, provider: 'existing-llm-fallback', model: null, isEvonInference: false };
}

export function evonAvailability() {
  return { hostedConfigured: Boolean(evonConfig.apiKey && evonConfig.baseUrl), hostedSchemaVerified: false, fallback: evonConfig.fallback };
}
