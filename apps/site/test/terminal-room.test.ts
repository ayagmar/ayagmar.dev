import { type ListeningSnapshot, type ShippingSnapshot, staleAfterSeconds } from '@min7/contracts';
import { snapshotFixtures } from '@min7/contracts/fixtures';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  frameFor,
  frames,
  type RoomFacts,
  renderTerminalRoom,
  roomFacts,
  scene,
  shrink,
  terminalCells,
  terminalLine,
} from '../src/lib/terminal-room.ts';
import { terminalRoom } from '../worker/room.ts';

const listening = snapshotFixtures.listening.ok as ListeningSnapshot;
const shipping = snapshotFixtures.shipping.ok as ShippingSnapshot;
const night = Date.parse('2026-10-26T22:00:00Z');
const blank = new Uint8Array(80 * 26 * 3);
const text = {
  listening: undefined,
  shipping: undefined,
  sample: false,
  origin: 'https://ayagmar.dev',
};
const words = (output: string) => output.split('\n').slice(13);

describe('the picture', () => {
  // Catches rows and columns swapped, or a cell averaging the wrong pixels.
  it('is the mean of each 6x6 cell, row by row', () => {
    const image = new Uint8Array(scene.width * scene.height * 3);
    for (let y = 6; y < 12; y++) {
      for (let x = 12; x < 18; x++) image.set([60, 120, 240], (y * scene.width + x) * 3);
    }
    image[(6 * scene.width + 18) * 3] = 36;
    const frame = shrink(image);
    expect([...frame.subarray((80 + 2) * 3, (80 + 2) * 3 + 3)]).toEqual([60, 120, 240]);
    expect(frame[(80 + 3) * 3]).toBe(1);
    expect(frame[2 * 3]).toBe(0);
    expect(frame.length).toBe(blank.length);
  });

  // Catches a line wider than an 80-column terminal, which would wrap the room apart.
  it('is 13 rows of 80 half-blocks', () => {
    const rows = renderTerminalRoom(blank, roomFacts(night), text).split('\n').slice(0, 13);
    for (const row of rows) expect(row.replace(/\p{Cc}\[[0-9;]*m/gu, '')).toBe('▀'.repeat(80));
  });

  // Catches a frame name that does not exist: sunrise in June comes before 07:00 in Rabat, so
  // the lamp's late hours overlap every sky.
  it('has a frame for every instant of a year', () => {
    const seen = new Set<string>();
    for (let time = Date.UTC(2026, 0, 1); time < Date.UTC(2027, 0, 1); time += 1_800_000) {
      seen.add(frameFor(roomFacts(time)));
    }
    expect([...seen].sort()).toEqual(Object.keys(frames).sort());
  });

  const facts = (sky: RoomFacts['sky'], fraction: number): RoomFacts => ({
    ...roomFacts(night),
    sky,
    moon: { elongation: 180, fraction, waxing: false, name: 'full moon' },
  });
  // The cell at (20, 4): the disc's centre, in the top half of text row 2.
  const moonCell = (output: string) => output.split('\n')[2]?.includes('38;2;232;232;250');

  // Catches the moon left out of the picture, or drawn in daylight as the page never does.
  it('shows the moon only as the page does', () => {
    expect(moonCell(renderTerminalRoom(blank, facts('night', 1), text))).toBe(true);
    expect(moonCell(renderTerminalRoom(blank, facts('day', 1), text))).toBe(false);
    expect(moonCell(renderTerminalRoom(blank, facts('night', 0.01), text))).toBe(false);
  });
});

describe('the words', () => {
  // Catches a Last.fm title or a pull request title sending commands to the reader's terminal.
  it('carry no control characters from other people', () => {
    const hostile = {
      ...listening,
      nowPlaying: { track: 'a\x1b[2Jb\x9b1m‮', artist: 'c\x07d', album: null, url: null },
    };
    const merge = {
      type: 'merge',
      repo: 'ayagmar/x',
      at: '2026-10-26T21:00:00Z',
      url: 'https://github.com/ayagmar/x/pull/1',
      number: 1,
      title: 'e\x1b]0;f\x07g',
    } as const;
    const output = renderTerminalRoom(blank, roomFacts(night), {
      ...text,
      listening: { data: hostile, fetchedAt: '2026-10-26T21:59:00Z', now: true },
      shipping: { ...shipping, events: [merge] },
    });
    expect(words(output).join('\n')).not.toMatch(/\p{Cc}(?<!\n)|\p{Cf}/u);
    expect(words(output)).toContain('Now playing a[2Jb1m by cd');
    expect(words(output).join('\n')).toContain('x merged #1: e]0;fg');
  });

  // Catches a long line wrapping under the room, which counting characters misses for CJK and
  // emoji, or a cut through the middle of a character made of several.
  it.each([
    ['ascii', 'x'.repeat(81), `${'x'.repeat(79)}…`],
    ['ascii that fits', 'x'.repeat(80), 'x'.repeat(80)],
    ['CJK', '音'.repeat(41), `${'音'.repeat(39)}…`],
    ['CJK that fits', '音'.repeat(40), '音'.repeat(40)],
    ['emoji', '🎧'.repeat(41), `${'🎧'.repeat(39)}…`],
    ['a flag', '🇲🇦'.repeat(41), `${'🇲🇦'.repeat(39)}…`],
    ['combining marks', 'e\u0301'.repeat(80), 'e\u0301'.repeat(80)],
    ['combining marks cut', 'e\u0301'.repeat(81), `${'e\u0301'.repeat(79)}…`],
  ])('cut %s at 80 cells', (_, line, cut) => {
    expect(terminalLine(line)).toBe(cut);
    expect(terminalCells(cut)).toBeLessThanOrEqual(80);
  });

  // Catches a Preview's commands sending the reader to production, or cut short by a long name.
  it('name commands that work where the copy is served', () => {
    const preview = `https://${'a-long-branch-'.repeat(4)}min7-site.ayagmar.workers.dev`;
    const production = words(renderTerminalRoom(blank, roomFacts(night), text));
    expect(production).toContain('  curl ayagmar.dev/writing');
    expect(production.at(-2)).toBe('Without colour: curl ayagmar.dev');
    const other = words(renderTerminalRoom(blank, roomFacts(night), { ...text, origin: preview }));
    expect(other).toContain(`  curl ${preview}/writing`);
    expect(other.at(-2)).toBe(`Without colour: curl ${preview}`);
  });
});

describe('the Worker', () => {
  const base = 'https://signals.test';
  const limit = staleAfterSeconds.listening * 1000;
  const start = Date.parse('2026-11-06T12:00:00Z');
  const iso = (time: number) => new Date(time).toISOString();
  const envelope = (source: string, data: unknown, at: number, stale = false) => ({
    source,
    version: 1,
    fetchedAt: iso(at),
    stale,
    data,
  });
  const playing = {
    ...listening,
    nowPlaying: { track: 'Live track', artist: 'Live artist', album: null, url: null },
  };
  const liveMerge = { ...shipping.events[0], number: 999, title: 'live merge' };
  const liveShipping = { ...shipping, events: [liveMerge] };
  const server = setupServer();
  let clock: number;
  let builtAt: number;
  let stored: Map<string, Response>;
  let failing: { match?: string; body?: string; put?: boolean };
  let writes: Promise<unknown>[];

  const assets = (signals: string | null) => ({
    fetch: async (request: Request) => {
      const { pathname } = new URL(request.url);
      if (pathname.endsWith('.rgb')) return new Response(blank);
      if (pathname === '/terminal/room.json') {
        return Response.json({
          origin: 'https://ayagmar.dev',
          signals,
          listeningLimitMs: limit,
          listening: envelope('listening', listening, builtAt),
          shipping: envelope('shipping', shipping, builtAt),
        });
      }
      return new Response('plain', { headers: { 'X-Robots-Tag': 'noindex', ETag: '"a"' } });
    },
  });
  const room = async (signals: string | null = base) => {
    const response = await terminalRoom(
      new Request('https://ayagmar.dev/room'),
      assets(signals),
      (work) => writes.push(work)
    );
    await Promise.all(writes);
    return { response, body: await response.text() };
  };
  const answer = (source: string, data: unknown, at = clock, stale = false) =>
    http.get(`${base}/v1/${source}`, () => HttpResponse.json(envelope(source, data, at, stale)));

  beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
  beforeEach(() => {
    clock = start;
    builtAt = start - 3_600_000;
    stored = new Map();
    failing = {};
    writes = [];
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    vi.stubGlobal('caches', {
      open: async () => ({
        match: async (key: string) => {
          if (failing.match && key.endsWith(failing.match)) throw new Error('cache down');
          if (failing.body && key.endsWith(failing.body)) {
            return { json: () => Promise.reject(new Error('bad body')) };
          }
          return stored.get(key)?.clone();
        },
        put: async (key: string, response: Response) => {
          if (failing.put) throw new Error('cache full');
          stored.set(key, response);
        },
      }),
    });
  });
  afterEach(() => {
    server.resetHandlers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  afterAll(() => server.close());

  // Catches the build's snapshot being called live, or a live answer being ignored.
  it('says what is playing from a current answer', async () => {
    server.use(answer('listening', playing), answer('shipping', shipping));
    const { body, response } = await room();
    expect(body).toContain('\nNow playing Live track by Live artist\n');
    expect(body).not.toContain('Sample data');
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex');
    expect(response.headers.get('ETag')).toBe(null);
  });

  // Catches a stale answer claiming a track is playing now.
  it('never says now playing from a stale answer', async () => {
    server.use(answer('listening', playing, clock, true), answer('shipping', shipping));
    expect((await room()).body).toContain('\nLast played Live track by Live artist');
  });

  // Catches a cached answer outliving the 15 minutes: signals stopped pulling, its last answer
  // said `stale: false` just before the limit, and this cache keeps it past it.
  it('stops saying now playing when a cached answer passes the limit', async () => {
    server.use(answer('listening', playing, start - limit + 1_000), answer('shipping', shipping));
    expect((await room()).body).toContain('\nNow playing Live track');
    clock = start + 30_000;
    const { body } = await room();
    expect(stored.size).toBe(2);
    expect(body).not.toContain('Now playing');
    expect(body).toContain('\nLast played Live track by Live artist');
  });

  // Catches the limit being checked against a clock read before the request went out.
  it('checks the limit after a read that crosses it', async () => {
    server.use(
      http.get(`${base}/v1/listening`, () => {
        const body = envelope('listening', playing, start - limit + 1_000);
        clock = start + 2_000;
        return HttpResponse.json(body);
      }),
      answer('shipping', shipping)
    );
    expect((await room()).body).not.toContain('Now playing');
  });

  // Catches an entry cached before a deploy replacing what the newer build knows.
  it('prefers a build newer than the live answers', async () => {
    builtAt = start;
    server.use(
      answer('listening', playing, start - 60_000),
      answer('shipping', liveShipping, start - 60_000)
    );
    const { body } = await room();
    expect(body).toContain('\nLast played Friendships and Love by Rocketship');
    expect(body).not.toContain('live merge');
  });

  // Catches a signals outage failing the room, or each terminal paying for it again.
  it('falls back to the build when signals fails, and caches the failure', async () => {
    let asked = 0;
    server.use(
      http.get(`${base}/v1/*`, () => {
        asked += 1;
        return new HttpResponse(null, { status: 500 });
      })
    );
    const first = await room();
    expect(first.response.status).toBe(200);
    expect(first.body).toContain('\nLast played Friendships and Love by Rocketship');
    await room();
    expect(asked).toBe(2);
  });

  // Catches the cache, an optimisation, taking the whole room down with one source.
  it('loses only the source whose cache lookup fails', async () => {
    failing.match = 'shipping';
    server.use(answer('listening', playing), answer('shipping', liveShipping));
    const { body, response } = await room();
    expect(response.status).toBe(200);
    expect(body).toContain('\nNow playing Live track');
    expect(body).not.toContain('live merge');
    expect(body).toContain('repo-pulse merged #28');
  });

  // Catches a cached entry that cannot be read failing the room.
  it('loses only the source whose cached body cannot be read', async () => {
    failing.body = 'listening';
    server.use(answer('listening', playing), answer('shipping', liveShipping));
    const { body, response } = await room();
    expect(response.status).toBe(200);
    expect(body).toContain('\nLast played Friendships and Love by Rocketship');
    expect(body).toContain('live merge');
  });

  // Catches a failed background write surfacing as an unhandled rejection.
  it('answers the same when the cache cannot be written', async () => {
    failing.put = true;
    server.use(answer('listening', playing), answer('shipping', shipping));
    expect((await room()).body).toContain('\nNow playing Live track');
  });

  // Catches a Preview or a test build reaching out to the network, or passing as live.
  it('asks nobody in fixtures mode and says so', async () => {
    expect((await room(null)).body).toContain('\nSample data, not live\n');
  });
});
