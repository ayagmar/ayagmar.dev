import { Hono } from 'hono';
import type { AppEnv } from './env.ts';
import { notFound, onError } from './errors.ts';
import { health } from './routes/v1/health.ts';

export const app = new Hono<AppEnv>()
  .route('/v1/health', health)
  .notFound(notFound)
  .onError(onError);
