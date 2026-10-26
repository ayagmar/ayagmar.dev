import type { ErrorHandler, NotFoundHandler } from 'hono';

export const notFound: NotFoundHandler = (c) => c.json({ error: 'not_found' }, 404);

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
  return c.json({ error: 'internal_error' }, 500);
};
