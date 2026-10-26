import { isStale, type SourceId, sourceIds, staleAfterSeconds } from '@min7/contracts';
import { Hono } from 'hono';
import type { AppEnv } from '../../env.ts';
import { methodNotAllowed } from '../../errors.ts';
import { preflight, withCors } from '../../security/cors.ts';
import { D1SnapshotStore } from '../../storage/d1.ts';

type SourceHealth = {
  source: SourceId;
  lastSuccessAt: string | null;
  stale: boolean;
  lastErrorCode: string | null;
};

/** `GET /v1/health`: the deployed commit and, for every source, how fresh it is. Not cached. */
export const health = new Hono<AppEnv>()
  .get('/', async (c) => {
    const now = new Date();
    const statuses = new Map(
      (await new D1SnapshotStore(c.env.DB).list()).map((status) => [status.source, status])
    );
    const sources: SourceHealth[] = sourceIds.map((source) => {
      const status = statuses.get(source);
      return {
        source,
        lastSuccessAt: status?.lastSuccessAt ?? null,
        stale: isStale(status?.fetchedAt ?? null, staleAfterSeconds[source], now),
        lastErrorCode: status?.lastErrorCode ?? null,
      };
    });
    const response = c.json({ version: c.env.COMMIT_SHA, sources }, 200, {
      'Cache-Control': 'no-store',
    });
    return withCors(response, c.req.header('origin'));
  })
  .options('/', (c) => preflight(c.req.header('origin')))
  .all('/', methodNotAllowed('GET, HEAD, OPTIONS'));
