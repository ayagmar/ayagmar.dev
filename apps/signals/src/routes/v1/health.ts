import { isStale, type SourceId, sourceIds, staleAfterSeconds } from '@min7/contracts';
import { Hono } from 'hono';
import type { AppEnv } from '../../env.ts';
import { methodNotAllowed } from '../../errors.ts';
import { preflight, withCors } from '../../security/cors.ts';
import { D1SnapshotStore } from '../../storage/d1.ts';
import { type DayStatus, readDayStatuses } from '../../storage/daily.ts';

type SourceHealth = {
  source: SourceId;
  lastSuccessAt: string | null;
  stale: boolean;
  lastErrorCode: string | null;
};

/**
 * How long a series may go without recording before it counts as stale: listening records
 * once an hour, so three missed hours; weather at every pull, so as its snapshot does.
 */
const recordingStaleSeconds = { listening: 3 * 60 * 60, weather: staleAfterSeconds.weather };

/**
 * `GET /v1/health`: the deployed commit, how fresh every source is and, apart from that, whether
 * the series that can fail alone are recording their days (ADR 0038). Not cached.
 */
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
    const days = (await readDayStatuses(c.env.DB)).map(
      ({ series, status }): DayStatus & { series: string; stale: boolean } => ({
        series,
        ...status,
        stale: isStale(status.lastSuccessAt, recordingStaleSeconds[series], now),
      })
    );
    const response = c.json({ version: c.env.COMMIT_SHA, sources, days }, 200, {
      'Cache-Control': 'no-store',
    });
    return withCors(response, c.req.header('origin'));
  })
  .options('/', (c) => preflight(c.req.header('origin')))
  .all('/', methodNotAllowed('GET, HEAD, OPTIONS'));
