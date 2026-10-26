import { Hono } from 'hono';
import type { AppEnv } from './env.ts';
import { notFound, onError } from './errors.ts';
import { health } from './routes/v1/health.ts';
import { listening } from './routes/v1/listening.ts';
import { llmUsage } from './routes/v1/llm-usage.ts';
import { projects } from './routes/v1/projects.ts';
import { push } from './routes/v1/push.ts';
import { shelf } from './routes/v1/shelf.ts';
import { shipping } from './routes/v1/shipping.ts';

export const app = new Hono<AppEnv>()
  .route('/v1/health', health)
  .route('/v1/listening', listening)
  .route('/v1/shipping', shipping)
  .route('/v1/projects', projects)
  .route('/v1/llm-usage', llmUsage)
  .route('/v1/shelf', shelf)
  .route('/v1/push', push)
  .notFound(notFound)
  .onError(onError);
