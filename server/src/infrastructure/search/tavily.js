import { env } from '../../config/env.js';
import { logger } from '../logging/logger.js';
import { withRetry } from '../../utils/retry.js';
export async function searchWeb(query, signal) {
  if (!env.TAVILY_API_KEY) throw Object.assign(new Error('Web search is not configured'), { code: 'SEARCH_NOT_CONFIGURED' });
  const response = await withRetry(async () => {
    const result = await fetch('https://api.tavily.com/search', { method: 'POST', signal, headers: { authorization: `Bearer ${env.TAVILY_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ query, search_depth: env.SEARCH_DEPTH, max_results: 5, include_answer: false, include_raw_content: true }) });
    if (!result.ok) {
      const error = Object.assign(new Error(`Search provider returned ${result.status}`), { code: 'SEARCH_FAILED', status: result.status, retryAfter: result.headers.get('retry-after') });
      if (result.status < 500 && result.status !== 429) error.noRetry = true;
      throw error;
    }
    return result;
  }, { retries: 2, signal, shouldRetry: (error) => !error.noRetry && (error.status === 429 || error.status >= 500 || error.name === 'TypeError') });
  let body;
  try { body = await response.json(); }
  catch { throw Object.assign(new Error('Search provider returned an invalid response'), { code: 'SEARCH_INVALID_RESPONSE' }); }
  if (!body || typeof body !== 'object' || !Array.isArray(body.results)) {
    throw Object.assign(new Error('Search provider returned an invalid response'), { code: 'SEARCH_INVALID_RESPONSE' });
  }
  const retrievedAt = new Date().toISOString();
  return body.results.filter((result) => result && typeof result.url === 'string').map((r) => ({ title: typeof r.title === 'string' ? r.title : r.url, url: r.url, snippet: typeof r.content === 'string' ? r.content : '', rawContent: typeof r.raw_content === 'string' ? r.raw_content : null, publishedAt: typeof r.published_date === 'string' ? r.published_date : null, retrievedAt }));
}
export async function searchQueries(queries, signal) {
  const startedAt = Date.now();
  const settled = await Promise.allSettled(queries.map((q) => searchWeb(q, signal)));
  const results = []; const failures = [];
  settled.forEach((item, i) => item.status === 'fulfilled' ? results.push(...item.value) : failures.push({ query: queries[i], error: item.reason?.code ?? 'SEARCH_FAILED' }));
  const seen = new Set(); const unique = results.filter((r) => { try { const u = new URL(r.url); if (u.protocol !== 'https:' && u.protocol !== 'http:') return false; u.hash = ''; const key = u.toString().replace(/\/$/, ''); if (seen.has(key)) return false; seen.add(key); return true; } catch { logger.warn('Ignoring invalid search result URL'); return false; } });
  logger.info({ queryCount: queries.length, resultCount: unique.length, failureCount: failures.length, durationMs: Date.now() - startedAt }, 'Web research completed');
  return { sources: unique, failures };
}
