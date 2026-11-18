import { afterEach, describe, expect, it, vi } from 'vitest';
process.env.TAVILY_API_KEY = 'test-key';
const { searchQueries } = await import('../../server/src/infrastructure/search/tavily.js');
const { generateWithGroq } = await import('../../server/src/infrastructure/llm/gemini.js');
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

describe('Tavily normalization', () => {
  it('deduplicates URLs and preserves successful results when another query fails', async () => {
    globalThis.fetch = vi.fn(async (_url, options) => {
      expect(options.headers.authorization).toBe('Bearer test-key');
      const { query } = JSON.parse(options.body);
      expect(options.body).not.toContain('test-key');
      if (query === 'broken') return new Response(JSON.stringify({ error: 'invalid query' }), { status: 400 });
      return new Response(JSON.stringify({ results: [
        { title: 'Pricing', url: 'https://example.com/pricing#plans', content: 'Official plan details', published_date: '2026-10-01' },
        { title: 'Duplicate', url: 'https://example.com/pricing', content: 'Same page' },
        { title: 'Unsafe', url: 'javascript:alert(1)', content: 'ignore' }
      ] }), { status: 200 });
    });
    const result = await searchQueries(['pricing', 'broken'], new AbortController().signal);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({ title: 'Pricing', publishedAt: '2026-10-01' });
    expect(result.sources[0].retrievedAt).toBeTruthy();
    expect(result.failures).toEqual([{ query: 'broken', error: 'SEARCH_FAILED' }]);
  });

  it('rejects malformed provider responses as a safe search failure', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ results: 'not-an-array' }), { status: 200 }));
    const result = await searchQueries(['crm and erp tools'], new AbortController().signal);
    expect(result.sources).toEqual([]);
    expect(result.failures).toEqual([{ query: 'crm and erp tools', error: 'SEARCH_INVALID_RESPONSE' }]);
  });

  it('retrieves CRM and ERP research and synthesizes an answer with the configured answer provider', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('tavily.com')) return new Response(JSON.stringify({ results: [
        { title: 'CRM software guide', url: 'https://example.com/crm', content: 'CRM platforms manage customer relationships, sales pipelines, and service.' },
        { title: 'ERP software guide', url: 'https://example.com/erp', content: 'ERP platforms connect finance, inventory, procurement, and operations.' }
      ] }), { status: 200 });
      return new Response(JSON.stringify({ choices: [{ message: { content: 'CRM tools manage customer relationships; ERP tools integrate business operations.' } }] }), { status: 200 });
    });
    const research = await searchQueries(['types of CRM and ERP tools'], new AbortController().signal);
    const answer = await generateWithGroq([{ role: 'user', content: `Answer from these findings: ${research.sources.map((source) => source.snippet).join(' ')}` }], undefined, { apiKey: 'test-key' });
    expect(research.failures).toEqual([]);
    expect(research.sources).toHaveLength(2);
    expect(answer).toContain('CRM tools manage customer relationships');
    expect(answer).toContain('ERP tools integrate business operations');
  });

  it('reports search provider unavailability without fabricating web results', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }));
    const result = await searchQueries(['types of CRM and ERP tools'], new AbortController().signal);
    expect(result.sources).toEqual([]);
    expect(result.failures).toEqual([{ query: 'types of CRM and ERP tools', error: 'SEARCH_FAILED' }]);
  });
});
