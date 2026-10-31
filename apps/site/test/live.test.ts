import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  anyEnvelopeSchema,
  listeningSnapshotSchema,
  monkeytypeSnapshotSchema,
  projectsSnapshotSchema,
  shippingSnapshotSchema,
} from '@min7/contracts';
import { snapshotFixtures } from '@min7/contracts/fixtures';
import { afterEach, describe, expect, it } from 'vitest';
import { nowPlaying, readListening } from '../src/lib/listening.ts';
import { ago, readAnswer } from '../src/lib/live.ts';
import { readProjects, readShipping } from '../src/lib/stats.ts';
import { daysAgo, readMonkeytype } from '../src/lib/typing.ts';

const corpus = join(import.meta.dirname, '../../../packages/contracts/corpus');
const files = (dir: string): [string, unknown][] =>
  readdirSync(join(corpus, dir)).map((file) => [
    `${dir}/${file}`,
    JSON.parse(readFileSync(join(corpus, dir, file), 'utf8')),
  ]);

// The browser cannot load zod, so each source has a hand-written reader. Catches a reader
// that shows data the contract rejects (a link off Last.fm or GitHub, a relative time, a day
// the calendar does not have) or drops data it accepts: every snapshot fixture, the reject
// corpus and cases at each check's edge, against the contract's own schema.
const readers = [
  {
    source: 'listening',
    read: readListening,
    schema: listeningSnapshotSchema,
    edges: {
      'played on 30 February': { recent: [{ playedAt: '2026-02-30T09:00:00Z' }] },
      'played at a time without an offset': { recent: [{ playedAt: '2026-10-26T09:00:00' }] },
      'played at the epoch': { recent: [{ playedAt: '1970-01-01T00:00:00Z' }] },
      'played on a leap day': { recent: [{ playedAt: '2028-02-29T23:59:59.5+01:00' }] },
      'a link to another site': { nowPlaying: { url: 'https://evil.example/www.last.fm/' } },
      'a script link': { nowPlaying: { url: 'javascript:alert(1)' } },
      // The page puts these links in an href as they are.
      'a recent track linked off Last.fm': { recent: [{ url: 'https://last.fm.evil.example/' }] },
      'a top artist linked by plain http': { topArtists: [{ url: 'http://www.last.fm/music/x' }] },
      'a top artist linked as a script': { topArtists: [{ url: 'javascript:alert(1)' }] },
      'an empty title': { nowPlaying: { track: '' } },
      'a fractional count': { scrobbles: { thisWeek: 1.5, lastWeek: 0 } },
      'eleven recent tracks': { recent: Array(11).fill({}) },
    },
  },
  {
    source: 'shipping',
    read: readShipping,
    schema: shippingSnapshotSchema,
    edges: {
      'an event on 31 April': { events: [{ at: '2026-04-31T10:00:00Z' }] },
      'a star day on 29 February 2026': {
        starHistory: [{ repo: 'ayagmar/kipple', points: [{ date: '2026-02-29', stars: 1 }] }],
      },
      'a star day with a time': {
        starHistory: [{ repo: 'ayagmar/kipple', points: [{ date: '2026-02-28T00', stars: 1 }] }],
      },
      'zero stars gained': { events: [{ type: 'stars', gained: 0 }] },
      'a release linked off GitHub': { events: [{ type: 'release', url: 'https://gitlab.com/x' }] },
      'a repository with a space': { events: [{ repo: 'ayagmar/ki pple' }] },
    },
  },
  {
    source: 'projects',
    read: readProjects,
    schema: projectsSnapshotSchema,
    edges: {
      'negative stars': { projects: [{ stars: -1 }] },
      'stars as a string': { projects: [{ stars: '35' }] },
      'a slug with capitals': { projects: [{ slug: 'Kipple' }] },
      'a release on 30 February': {
        projects: [{ latestRelease: { publishedAt: '2026-02-30T00:00:00Z' } }],
      },
      'an npm name with a space': { projects: [{ npm: { package: 'a b' } }] },
      'archived as a string': { projects: [{ archived: 'no' }] },
    },
    // Not projects at all, though each has a star count /stats could add up.
    raw: { 'a project with only its stars': { projects: [{ stars: 9000 }] } },
  },
  {
    source: 'monkeytype',
    read: readMonkeytype,
    schema: monkeytypeSnapshotSchema,
    edges: {
      'accuracy over 100': { time: { 60: { acc: 100.5 } } },
      'negative raw': {
        words: { 10: { wpm: 1, acc: 1, raw: -1, consistency: 1, date: '2026-10-26' } },
      },
      'consistency as a string': { time: { 15: { consistency: '73' } } },
      'set on 29 February 2026': { time: { 30: { date: '2026-02-29' } } },
      'set at a time': { time: { 60: { date: '2021-01-14T10:00:00Z' } } },
      'zero for none': { time: { 120: 0 } },
      'a slot left out': { words: { 100: undefined } },
    },
    raw: {
      'words left out': { time: snapshotFixtures.monkeytype.ok.time },
      'time as an array': { ...snapshotFixtures.monkeytype.ok, time: Array(121).fill(null) },
      'words as an array': { ...snapshotFixtures.monkeytype.ok, words: Array(101).fill(null) },
    },
    // Its corpus holds whole envelopes (ADR 0008); the reader reads their data.
    envelopes: true,
  },
] as const;

/** `base` with `edge` merged in, list items merged into `base`'s first item. */
function merge(base: unknown, edge: unknown): unknown {
  if (Array.isArray(edge)) {
    const first = Array.isArray(base) ? base[0] : undefined;
    return edge.map((item) => merge(first, item));
  }
  if (typeof edge !== 'object' || edge === null || typeof base !== 'object' || base === null) {
    return edge;
  }
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(edge)) {
    merged[key] = merge((base as Record<string, unknown>)[key], value);
  }
  return merged;
}

describe.each(readers)('the $source reader', ({ source, read, schema, edges, ...rest }) => {
  const ok = snapshotFixtures[source].ok;
  const cases: [string, unknown][] = [
    ...Object.entries(snapshotFixtures[source]).map(([name, data]): [string, unknown] => [
      `fixture ${name}`,
      data,
    ]),
    ...files(`${source}/reject`).map(([name, body]): [string, unknown] => [
      name,
      'envelopes' in rest ? Object(body).data : body,
    ]),
    ...Object.entries(edges).map(([name, edge]): [string, unknown] => [name, merge(ok, edge)]),
    ...Object.entries('raw' in rest ? rest.raw : {}),
  ];

  it.each(cases)('agrees with the contract on %s', (name, data) => {
    const accepted = schema.safeParse(data).success;
    expect(read(data) !== undefined, name).toBe(accepted);
  });

  it('keeps the edge cases meaningful', () => {
    // Each edge case must differ from the fixture it is built on, or it tests nothing.
    for (const edge of Object.values(edges)) expect(merge(ok, edge)).not.toEqual(ok);
  });
});

describe('daysAgo', () => {
  const zone = process.env.TZ;
  afterEach(() => {
    process.env.TZ = zone;
  });

  // Catches a best set years ago read in days.
  it.each([
    ['2026-10-26', 'today'],
    ['2026-10-27', 'today'],
    ['2026-10-25', 'yesterday'],
    ['2026-10-14', '12 days ago'],
    ['2026-09-26', 'last month'],
    ['2026-07-15', '3 months ago'],
    ['2025-10-26', 'last year'],
    ['2021-01-14', '5 years ago'],
  ])('reads %s as %s', (date, words) => {
    process.env.TZ = 'UTC';
    expect(daysAgo(date, Date.parse('2026-10-26T23:30:00Z'))).toBe(words);
  });

  // Catches days counted in UTC, from 24-hour spans, or from the date's UTC midnight moved into
  // the reader's time zone: a best set on 26 October is today until the reader's own midnight,
  // on either side of UTC.
  it.each([
    ['Asia/Tokyo', '2026-10-26T14:30:00Z', 'today'], // 23:30 on the 26th
    ['Asia/Tokyo', '2026-10-26T15:30:00Z', 'yesterday'], // 00:30 on the 27th
    ['America/Los_Angeles', '2026-10-26T07:30:00Z', 'today'], // 00:30 on the 26th
    ['America/Los_Angeles', '2026-10-27T06:30:00Z', 'today'], // 23:30 on the 26th
    ['America/Los_Angeles', '2026-10-27T07:30:00Z', 'yesterday'], // 00:30 on the 27th
  ])("reads 2026-10-26 in %s at %s by the reader's calendar", (timeZone, now, words) => {
    process.env.TZ = timeZone;
    expect(daysAgo('2026-10-26', Date.parse(now))).toBe(words);
  });
});

describe('readAnswer', () => {
  const now = Date.parse('2026-10-26T12:00:00Z');
  const identity = (data: unknown) => data;

  // Catches an envelope the contract rejects being shown, and a never-succeeded source being
  // drawn as data: the contract's envelope corpus, each read as its own source.
  it.each([...files('envelope/accept'), ...files('envelope/reject')])('%s', (name, body) => {
    const { source } = Object(body);
    const contract = anyEnvelopeSchema.safeParse(body);
    const shown = contract.success && contract.data.data !== null;
    expect(readAnswer(body, source, identity, now) !== undefined, name).toBe(shown);
  });

  const envelope = (fields: object) => ({
    source: 'listening',
    version: 1,
    fetchedAt: '2026-10-26T11:59:00Z',
    stale: false,
    data: snapshotFixtures.listening.ok,
    ...fields,
  });

  it('reads a valid answer with its time', () => {
    expect(readAnswer(envelope({ stale: true }), 'listening', readListening, now)).toEqual({
      data: snapshotFixtures.listening.ok,
      fetchedAt: '2026-10-26T11:59:00Z',
      at: Date.parse('2026-10-26T11:59:00Z'),
      stale: true,
    });
  });

  // A clock a little ahead of the reader's is believable; a time well in the future, another
  // source's answer or data the reader rejects is not shown.
  it.each([
    ['a minute ahead', { fetchedAt: '2026-10-26T12:01:00Z' }, true],
    ['an hour ahead', { fetchedAt: '2026-10-26T13:00:00Z' }, false],
    ['on 31 September', { fetchedAt: '2026-09-31T12:00:00Z' }, false],
    ['for another source', { source: 'shipping' }, false],
    ['with invalid data', { data: { nowPlaying: 'x' } }, false],
    ['not an object', { data: undefined }, false],
  ])('an answer %s is %s', (_, fields, shown) => {
    expect(readAnswer(envelope(fields), 'listening', readListening, now) !== undefined).toBe(shown);
  });

  it('ignores a body that is not an envelope', () => {
    for (const body of [undefined, null, 'listening', 42, []]) {
      expect(readAnswer(body, 'listening', readListening, now)).toBeUndefined();
    }
  });
});

describe('ago', () => {
  const zone = process.env.TZ;
  afterEach(() => {
    process.env.TZ = zone;
  });

  const at = (iso: string) => Date.parse(iso);

  it('counts minutes, then hours', () => {
    process.env.TZ = 'UTC';
    const now = at('2026-10-26T12:00:00Z');
    expect(ago(at('2026-10-26T11:59:30Z'), now)).toBe('just now');
    expect(ago(at('2026-10-26T12:05:00Z'), now)).toBe('just now');
    expect(ago(at('2026-10-26T11:59:00Z'), now)).toBe('1 minute ago');
    expect(ago(at('2026-10-26T11:01:00Z'), now)).toBe('59 minutes ago');
    expect(ago(at('2026-10-26T11:00:00Z'), now)).toBe('1 hour ago');
    expect(ago(at('2026-10-26T00:00:00Z'), now)).toBe('12 hours ago');
  });

  // Catches "yesterday" computed in UTC, or from 24-hour spans, rather than from the reader's
  // calendar: the same two instants read differently on either side of the world.
  it("says yesterday by the reader's own calendar", () => {
    const then = at('2026-10-26T03:00:00Z');
    const now = at('2026-10-26T14:00:00Z');
    process.env.TZ = 'America/New_York'; // 23:00 on the 25th, then 10:00 on the 26th
    expect(ago(then, now)).toBe('yesterday');
    process.env.TZ = 'Asia/Tokyo'; // 12:00, then 23:00, both on the 26th
    expect(ago(then, now)).toBe('11 hours ago');
  });

  it('counts hours across midnight until 6 hours have passed', () => {
    process.env.TZ = 'Africa/Casablanca';
    expect(ago(at('2026-10-25T23:30:00Z'), at('2026-10-26T00:10:00Z'))).toBe('40 minutes ago');
    expect(ago(at('2026-10-25T21:00:00Z'), at('2026-10-26T02:30:00Z'))).toBe('5 hours ago');
    expect(ago(at('2026-10-25T20:00:00Z'), at('2026-10-26T02:30:00Z'))).toBe('yesterday');
  });

  it('counts days for a week, then gives the date', () => {
    process.env.TZ = 'UTC';
    const now = at('2026-10-26T12:00:00Z');
    expect(ago(at('2026-10-23T18:00:00Z'), now)).toBe('3 days ago');
    expect(ago(at('2026-10-19T12:00:00Z'), now)).toBe('19 Oct');
    expect(ago(at('2025-12-31T12:00:00Z'), now)).toBe('31 Dec 2025');
  });
});

describe('nowPlaying', () => {
  const { ok } = snapshotFixtures.listening;
  const track = { track: 'Which Will', artist: 'Nick Drake', album: null, url: null };
  const fetchedAt = '2026-10-26T10:30:00Z';

  // Catches "Now playing" from a stale answer or from the build, which cannot know.
  it('says now playing only for an answer that describes now, with a track', () => {
    const data = { ...ok, nowPlaying: track };
    expect(nowPlaying(data, fetchedAt, true)).toMatchObject({
      lead: 'Now playing',
      playing: true,
      track,
      at: null,
    });
    expect(nowPlaying(data, fetchedAt, false)).toMatchObject({
      lead: 'Last played',
      playing: false,
      track: { track: 'Which Will' },
      at: fetchedAt,
    });
  });

  it('falls back to the last scrobble, with when it was played', () => {
    const data = { ...ok, nowPlaying: null };
    const [last] = ok.recent;
    expect(nowPlaying(data, fetchedAt, true)).toMatchObject({
      lead: 'Last played',
      playing: false,
      track: { track: last?.track },
      at: last?.playedAt,
    });
  });

  // Catches an old empty answer passed off as current: without a track, the line still says
  // when it was checked, unless the answer describes now.
  it('says nothing is playing when there is no track at all, dated unless now', () => {
    const data = { ...ok, nowPlaying: null, recent: [] };
    expect(nowPlaying(data, fetchedAt, true)).toMatchObject({
      lead: 'Nothing playing right now',
      at: null,
    });
    expect(nowPlaying(data, fetchedAt, false)).toMatchObject({
      lead: 'Nothing played lately',
      at: fetchedAt,
    });
  });
});
