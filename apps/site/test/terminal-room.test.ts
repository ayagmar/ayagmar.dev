import type { ListeningSnapshot, ShippingSnapshot } from '@min7/contracts';
import { snapshotFixtures } from '@min7/contracts/fixtures';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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
  const fetchedAt = new Date(Date.now() - 60_000).toISOString();
  const envelope = (source: string, data: unknown, stale = false) => ({
    source,
    version: 1,
    fetchedAt,
    stale,
    data,
  });
  const playing = {
    ...listening,
    nowPlaying: { track: 'Live track', artist: 'Live artist', album: null, url: null },
  };
  const server = setupServer();
  let stored: Map<string, Response>;
  const assets = (signals: string | null) => ({
    fetch: async (request: Request) => {
      const { pathname } = new URL(request.url);
      if (pathname.endsWith('.rgb')) return new Response(blank);
      if (pathname === '/terminal/room.json') {
        return Response.json({
          origin: 'https://ayagmar.dev',
          signals,
          listening: envelope('listening', listening),
          shipping: envelope('shipping', shipping),
        });
      }
      return new Response('plain', { headers: { 'X-Robots-Tag': 'noindex', ETag: '"a"' } });
    },
  });
  const room = async (signals: string | null = base) => {
    const response = await terminalRoom(
      new Request('https://ayagmar.dev/room'),
      assets(signals),
      () => undefined
    );
    return { response, body: await response.text() };
  };

  beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
  afterEach(() => {
    server.resetHandlers();
    vi.unstubAllGlobals();
  });
  afterAll(() => server.close());

  const useCache = () => {
    stored = new Map();
    vi.stubGlobal('caches', {
      open: async () => ({
        match: async (key: string) => stored.get(key)?.clone(),
        put: async (key: string, response: Response) => void stored.set(key, response),
      }),
    });
  };

  // Catches the build's snapshot being called live, or a live answer being ignored.
  it('says what is playing from a current answer', async () => {
    useCache();
    server.use(
      http.get(`${base}/v1/listening`, () => HttpResponse.json(envelope('listening', playing))),
      http.get(`${base}/v1/shipping`, () => HttpResponse.json(envelope('shipping', shipping)))
    );
    const { body, response } = await room();
    expect(body).toContain('\nNow playing Live track by Live artist\n');
    expect(body).not.toContain('Sample data');
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex');
    expect(response.headers.get('ETag')).toBe(null);
  });

  // Catches a stale answer claiming a track is playing now.
  it('never says now playing from a stale answer', async () => {
    useCache();
    server.use(
      http.get(`${base}/v1/listening`, () =>
        HttpResponse.json(envelope('listening', playing, true))
      ),
      http.get(`${base}/v1/shipping`, () => HttpResponse.json(envelope('shipping', shipping)))
    );
    expect((await room()).body).not.toContain('Now playing');
  });

  // Catches a signals outage failing the room, or each terminal paying for it again.
  it('falls back to the build when signals fails, and asks once a minute', async () => {
    useCache();
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

  // Catches a Preview or a test build reaching out to the network, or passing as live.
  it('asks nobody in fixtures mode and says so', async () => {
    useCache();
    expect((await room(null)).body).toContain('\nSample data, not live\n');
  });
});
