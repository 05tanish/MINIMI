export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      if (!env.API_ORIGIN) {
        return Response.json({
          success: false,
          data: null,
          error: {
            code: 'API_NOT_CONFIGURED',
            message: 'The API service is not configured for this deployment.'
          }
        }, { status: 503 });
      }

      const apiUrl = new URL(`${url.pathname}${url.search}`, env.API_ORIGIN);
      return fetch(new Request(apiUrl, request));
    }

    return env.ASSETS.fetch(request);
  }
};
