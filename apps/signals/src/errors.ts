import type { ErrorHandler, NotFoundHandler } from 'hono';

export const notFound: NotFoundHandler = (c) => c.json({ error: 'not_found' }, 404);

// Responses never carry error details; the log keeps them for debugging.
export const onError: ErrorHandler = (error, c) => {
  console.error(
    JSON.stringify({
      message: 'unhandled error',
      method: c.req.method,
      path: c.req.path,
      error: error.name,
      detail: error.message,
    })
  );
  return c.json({ error: 'internal_error' }, 500);
};
