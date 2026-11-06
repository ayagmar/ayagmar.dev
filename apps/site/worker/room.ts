// `curl ayagmar.dev/room` (ADR 0045): the room as it is now, for a terminal that asked for it.
import { readListening } from '../src/lib/listening.ts';
import { readAnswer } from '../src/lib/live.ts';
import { readShipping } from '../src/lib/stats.ts';
import { frameFor, renderTerminalRoom, roomFacts } from '../src/lib/terminal-room.ts';

/** Signals pulls no faster than a minute, and its own read cache lasts as long. */
const cacheSeconds = 60;
/** A slow signals must not hold up a terminal: past this the room shows the build's answers. */
const deadlineMs = 1_000;

/** The Worker's `ctx.waitUntil`. */
type Later = (work: Promise<unknown>) => void;

interface Built {
  origin: string;
  signals: string | null;
  listening: unknown;
  shipping: unknown;
}

/**
 * The JSON signals answers for `source`, or null. Kept a minute in this data centre, failures
 * included, so a burst of terminals costs signals one read a minute and a dead signals one wait.
 */
async function latest(source: string, base: string, origin: string, later: Later) {
  const key = `${origin}/terminal/live/${source}`;
  const cache = await caches.open('terminal-room');
  const cached = await cache.match(key);
  if (cached !== undefined) return cached.json();
  const body = await fetch(`${base}/v1/${source}`, { signal: AbortSignal.timeout(deadlineMs) })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  later(
    cache.put(key, Response.json(body, { headers: { 'Cache-Control': `max-age=${cacheSeconds}` } }))
  );
  return body;
}

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
  const liveListening = readAnswer(listening, 'listening', readListening, time);
  const current = liveListening?.stale === false ? liveListening : undefined;
  const heard = current ?? readAnswer(built.listening, 'listening', readListening, time);
  const shipped =
    readAnswer(shipping, 'shipping', readShipping, time) ??
    readAnswer(built.shipping, 'shipping', readShipping, time);
  const body = renderTerminalRoom(new Uint8Array(frame), facts, {
    listening:
      heard === undefined
        ? undefined
        : { data: heard.data, fetchedAt: heard.fetchedAt, now: heard === current },
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
