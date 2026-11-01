import { type Envelope, isStale, type SourceId, staleAfterSeconds } from '@min7/contracts';
import { type Context, Hono } from 'hono';
import type { AppEnv } from '../../env.ts';
import { methodNotAllowed } from '../../errors.ts';
import { preflight, withCors } from '../../security/cors.ts';
import { D1SnapshotStore } from '../../storage/d1.ts';

/** Longest a snapshot response is cached, at the edge and in the browser. */
const maxCacheSeconds = 60;
/** Unix ms after which the cached copy must not be served; kept out of client responses. */
const expiresHeader = 'X-Min7-Expires-At';

/** What an envelope is built from: when its data was true, and the data, null until then. */
export interface EnvelopeSource {
  fetchedAt: string | null;
  data: unknown;
}

const envelopeFor = (
  source: SourceId,
  { fetchedAt, data }: EnvelopeSource,
  now: number
): Envelope<unknown> => ({
  source,
  version: 1,
  fetchedAt,
  stale: isStale(fetchedAt, staleAfterSeconds[source], new Date(now)),
  data,
});

/**
 * Seconds the envelope may be reused: never past the moment `stale` flips to true, so a
 * cached copy never claims to be fresh when it no longer is.
 */
function cacheSeconds(source: SourceId, fetchedAt: string | null, now: number): number {
  if (fetchedAt === null) return maxCacheSeconds;
  const untilStale = Date.parse(fetchedAt) + staleAfterSeconds[source] * 1000 - now;
  if (untilStale <= 0) return maxCacheSeconds;
  return Math.min(maxCacheSeconds, Math.floor(untilStale / 1000));
}

/** The response every client gets from a cached or fresh copy: TTL left, CORS for its origin. */
function forClient(copy: Response, now: number, origin: string | undefined): Response {
  const response = new Response(copy.body, copy);
  const left = Math.max(0, Math.floor((Number(response.headers.get(expiresHeader)) - now) / 1000));
  response.headers.delete(expiresHeader);
  response.headers.set('Cache-Control', left > 0 ? `public, max-age=${left}` : 'no-cache');
  return withCors(response, origin);
}

/**
 * Serves `source`'s envelope from the edge cache under `path` (no query string, method or
 * origin in the key), or builds it from `read` and caches it.
 */
export async function serveEnvelope(
  c: Context<AppEnv>,
  source: SourceId,
  path: string,
  read: () => Promise<EnvelopeSource>
): Promise<Response> {
  const key = new Request(`${new URL(c.req.url).origin}${path}`);
  const cache = caches.default;
  const origin = c.req.header('origin');

  // The edge may keep a copy longer than asked; past its own expiry it could claim a
  // freshness that no longer holds, so it is rebuilt instead.
  const cached = await cache.match(key);
  if (cached && Number(cached.headers.get(expiresHeader)) > Date.now()) {
    return forClient(cached, Date.now(), origin);
  }

  const stored = await read();
  // Read after D1 answers, so a slow read cannot produce an envelope that is already wrong.
  const now = Date.now();
  const envelope = envelopeFor(source, stored, now);
  const ttl = cacheSeconds(source, envelope.fetchedAt, now);
  const copy = new Response(JSON.stringify(envelope), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${ttl}`,
      [expiresHeader]: String(now + ttl * 1000),
    },
  });
  if (ttl > 0) c.executionCtx.waitUntil(cache.put(key, copy.clone()));
  return forClient(copy, now, origin);
}

/** `GET /v1/<source>`: the source's envelope. HEAD is answered from GET without a body. */
export const snapshotRoute = (source: SourceId) =>
  new Hono<AppEnv>()
    .get('/', (c) =>
      serveEnvelope(c, source, new URL(c.req.url).pathname, async () => {
        const stored = await new D1SnapshotStore(c.env.DB).get(source);
        return { fetchedAt: stored?.fetchedAt ?? null, data: stored?.snapshot ?? null };
      })
    )
    .options('/', (c) => preflight(c.req.header('origin')))
    .all('/', methodNotAllowed('GET, HEAD, OPTIONS'));
