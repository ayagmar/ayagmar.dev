import type { SourceId } from '@min7/contracts';
import { Hono } from 'hono';
import type { AppEnv } from '../../env.ts';

type SourceHealth = { source: SourceId; lastSuccessAt: string | null };

export const health = new Hono<AppEnv>().get('/', (c) => {
  const sources: SourceHealth[] = [];
  return c.json({ version: c.env.COMMIT_SHA, sources });
});
