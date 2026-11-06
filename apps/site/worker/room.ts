// `curl ayagmar.dev/room` (ADR 0045): the room as it is now, for a terminal that asked for it.
import { readListening } from '../src/lib/listening.ts';
import { type Answer, isCurrent, readAnswer } from '../src/lib/live.ts';
import { readShipping } from '../src/lib/stats.ts';
import { frameFor, renderTerminalRoom, roomFacts } from '../src/lib/terminal-room.ts';

/** Signals pulls no faster than a minute, and its own read cache lasts as long. */
const cacheSeconds = 60;
/** A slow signals or cache must not hold up a terminal: past this the build's answers show. */
const deadlineMs = 1_000;

/** The Worker's `ctx.waitUntil`. */
type Later = (work: Promise<unknown>) => void;

interface Built {
  origin: string;
  signals: string | null;
  listeningLimitMs: number;
  listening: unknown;
  shipping: unknown;
}

/**
 * The JSON signals answers for `source`, kept a minute in this data centre, failures included.
 * The Cache API is best-effort and each data centre has its own: terminals arriving together on
 * a cold cache each ask signals, so a minute's reads are usually one per source, not at most one.
 * Requests cannot share a pending read, as a Worker may not await another request's promise.
 */
async function cachedRead(source: string, base: string, origin: string, later: Later) {
  const key = `${origin}/terminal/live/${source}`;
  const cache = await caches.open('terminal-room');
  const cached = await cache.match(key);
  if (cached !== undefined) return cached.json();
  const body = await fetch(`${base}/v1/${source}`, { signal: AbortSignal.timeout(deadlineMs) })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  later(
    cache
      .put(key, Response.json(body, { headers: { 'Cache-Control': `max-age=${cacheSeconds}` } }))
      .catch(() => undefined)
  );
  return body;
}

/**
 * `cachedRead`, or null if it fails or runs past the deadline, the cache's part included. A broken
 * cache means no live answer rather than a read per request, and costs only this source: the
 * room is drawn from the build's answer for it.
 */
const latest = (source: string, base: string, origin: string, later: Later): Promise<unknown> =>
  Promise.race([
    cachedRead(source, base, origin, later).catch(() => null),
    new Promise((resolve) => setTimeout(resolve, deadlineMs, null)),
  ]);

/** The newer of two answers, `live` if they are as old. */
const newest = <Data>(live: Answer<Data> | undefined, built: Answer<Data> | undefined) =>
  live === undefined || (built !== undefined && live.at < built.at) ? built : live;

/** The room's answer. Its headers are the plain copy's, so it carries the `_headers` rules. */
export async function terminalRoom(
  request: Request,
  assets: { fetch: (request: Request) => Promise<Response> },
  later: Later
): Promise<Response> {
  const { origin } = new URL(request.url);
  const asset = (path: string) => assets.fetch(new Request(new URL(path, origin)));
  const time = Date.now();
  const facts = roomFacts(time);
  const [plain, frame, built] = await Promise.all([
    asset('/index.txt'),
    asset(`/terminal/${frameFor(facts)}.rgb`).then((response) => response.arrayBuffer()),
    asset('/terminal/room.json').then((response) => response.json() as Promise<Built>),
  ]);
  const base = built.signals;
  const [listening, shipping] =
    base === null
      ? [undefined, undefined]
      : await Promise.all([
          latest('listening', base, origin, later),
          latest('shipping', base, origin, later),
        ]);
  // Read after the waits above: an answer can pass its limit during them, or while cached.
  const now = Date.now();
  const live = readAnswer(listening, 'listening', readListening, now);
  const build = readAnswer(built.listening, 'listening', readListening, now);
  const heard = newest(live, build);
  const shipped = newest(
    readAnswer(shipping, 'shipping', readShipping, now),
    readAnswer(built.shipping, 'shipping', readShipping, now)
  );
  const body = renderTerminalRoom(new Uint8Array(frame), facts, {
    listening:
      heard === undefined
        ? undefined
        : {
            data: heard.data,
            fetchedAt: heard.fetchedAt,
            now: heard === live && isCurrent(live, built.listeningLimitMs, now, build?.at ?? NaN),
          },
    shipping: shipped?.data,
    sample: base === null,
    origin: built.origin,
  });
  const headers = new Headers(plain.headers);
  headers.delete('ETag');
  headers.delete('CF-Cache-Status');
  headers.set('Cache-Control', 'no-store');
  return new Response(request.method === 'HEAD' ? null : body, { headers });
}
