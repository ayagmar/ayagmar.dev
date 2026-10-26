import type { ErrorHandler, NotFoundHandler } from 'hono';

export const notFound: NotFoundHandler = (c) => c.json({ error: 'not_found' }, 404);

/** 405 for a method a route does not serve, with the methods it does in `Allow`. */
export const methodNotAllowed = (allow: string) => () =>
  new Response(JSON.stringify({ error: 'method_not_allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json', Allow: allow, 'Cache-Control': 'no-store' },
  });

// Neither the response nor the log carries the error's name or message: either can hold an
// upstream URL, token or response body. Code that can fail on purpose logs its own error code.
export const onError: ErrorHandler = (_error, c) => {
  console.error(
    JSON.stringify({
      message: 'unhandled error',
      code: 'internal_error',
      method: c.req.method,
      path: c.req.path,
    })
  );
  return c.json({ error: 'internal_error' }, 500, { 'Cache-Control': 'no-store' });
};
