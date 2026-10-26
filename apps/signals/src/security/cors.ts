/** The only origin allowed to read the API from a browser (ADR 0010). */
const allowedOrigin = 'https://ayagmar.dev';

/**
 * Adds CORS headers for `origin` to a response that is otherwise the same for every origin,
 * so it can be cached once and served to all of them.
 */
export function withCors(response: Response, origin: string | undefined): Response {
  response.headers.append('Vary', 'Origin');
  if (origin === allowedOrigin) response.headers.set('Access-Control-Allow-Origin', origin);
  return response;
}

/** Answer to a CORS preflight on a read route. Never cached. */
export function preflight(origin: string | undefined): Response {
  const response = new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  if (origin === allowedOrigin) {
    response.headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    response.headers.set('Access-Control-Max-Age', '86400');
  }
  return withCors(response, origin);
}
