export class GnaniError extends Error {
  constructor(message, { code = 'GNANI_PROVIDER_ERROR', status, retryable = false, requestId } = {}) {
    super(message);
    this.name = 'GnaniError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.requestId = requestId;
  }
}

export async function readProviderError(response) {
  let body = {};
  try { body = await response.json(); } catch {}
  const detail = body?.error?.message || body?.message || body?.detail?.message || 'Gnani request failed.';
  const status = response.status;
  return new GnaniError(detail, {
    status,
    requestId: body?.request_id,
    code: status === 401 || status === 403 ? 'GNANI_AUTH_FAILED' : status === 429 ? 'GNANI_RATE_LIMITED' : status >= 500 ? 'GNANI_UNAVAILABLE' : 'GNANI_INVALID_REQUEST',
    retryable: status === 429 || status >= 500
  });
}
