import type { ListeningSnapshot, LlmUsageSnapshot, ShippingEvent } from '@min7/contracts';
import { snapshotFixtures } from '@min7/contracts/fixtures';
import { rabatDate } from '@min7/contracts/rabat';
import { describe, expect, it } from 'vitest';
import { readListening } from '../src/lib/listening.ts';
import { follow } from '../src/lib/live.ts';
import { hotspotWords, roomObjects } from '../src/lib/room.ts';
import { roomSeed } from '../src/lib/room-seed.ts';
import {
  changedParts,
  liveReading,
  type Reading,
  type RoomInputs,
  type RoomListening,
  type RoomMoment,
  type RoomPost,
  roomState,
  seededInputs,
  shelfSlots,
} from '../src/lib/room-state.ts';
import { dayMs } from '../src/lib/words.ts';

// The room's truth (ADR 0043), through `roomState` and the reader: the clock is an argument and
// nothing else is faked.
const minute = 60_000;
const limit = 15 * minute;
const noon = Date.parse('2026-10-26T12:00:00Z');
const iso = (time: number) => new Date(time).toISOString();
const track = { track: 'Which Will', artist: 'Nick Drake', album: null, url: null };

const reading = <Data>(
  data: Data,
  at = noon,
  origin: Reading<Data>['origin'] = 'build',
  currentUntil: number | null = null
): Reading<Data> => ({ data, fetchedAt: iso(at), at, origin, currentUntil });

const inputs = (over: Partial<RoomInputs> = {}): RoomInputs => ({
  knowsRabat: true,
  posts: [],
  shipping: null,
  usage: null,
  listening: null,
  weather: undefined,
  ...over,
});

const live = (instant = noon): RoomMoment & { kind: 'live' } => ({ kind: 'live', instant });
const past = (instant: number): RoomMoment & { kind: 'past' } => ({ kind: 'past', instant });

const recent = (playedAt: string, name = 'Old song') => ({ ...track, track: name, playedAt });
const merge = (repo: string, at: string, number = 1): ShippingEvent => ({
  type: 'merge',
  repo,
  at,
  url: `https://github.com/${repo}/pull/${number}`,
  number,
  title: `change ${number}`,
});
const push = (repo: string, at: string, commits = 2): ShippingEvent => ({
  type: 'push',
  repo,
  at,
  url: `https://github.com/${repo}/commits`,
  commits,
});

/** A repeatable stream of numbers below `max`, as in progress.test.ts. */
function seeded(start: number) {
  let state = start;
  return (max: number) => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state % max;
  };
}

describe('the clock', () => {
  // Catches the build painting a sky no clock told it: the no-JS room must stay static (ADR 0027).
  it('is absent from the build', () => {
    const state = roomState(inputs(), { kind: 'built', instant: noon });
    expect([state.window, state.lamp]).toEqual([null, null]);
  });

  // Catches the cat at 05:00, or a lamp on a guessed hour without Morocco's current rules.
  it.each([
    ['2026-10-26T01:59:00Z', true, false, false],
    ['2026-10-26T02:00:00Z', true, true, true],
    ['2026-10-26T04:59:00Z', true, true, true],
    ['2026-10-26T05:00:00Z', true, true, false],
    ['2026-10-26T06:59:00Z', true, true, false],
    ['2026-10-26T07:00:00Z', true, false, false],
    ['2026-10-26T03:00:00Z', false, false, false],
  ])('at %s with rules %s: lamp down %s, cat %s', (time, knowsRabat, late, cat) => {
    const { lamp } = roomState(inputs({ knowsRabat }), live(Date.parse(time)));
    expect([lamp.late, lamp.cat]).toEqual([late, cat]);
  });

  const weather = (fetchedAt: number) => ({
    source: 'weather',
    version: 1,
    stale: false,
    fetchedAt: iso(fetchedAt),
    data: {
      observedAt: iso(fetchedAt),
      weatherCode: 61,
      cloudCoverPercent: 90,
      precipitationMm: 1,
      windSpeedKmh: 10,
      isDay: true,
      temperatureC: 14,
    },
  });

  // Catches weather shown past its 45 minutes, or today's rain painted on a past moment.
  it('shows weather only as a live moment may', () => {
    const body = inputs({ weather: weather(noon) });
    expect(roomState(body, live(noon)).window.label).toBe(
      'Through the window: daylight over Rabat, slight rain, 14 °C.'
    );
    expect(roomState(body, live(noon + 46 * minute)).window.weather).toBe(null);
    expect(roomState(body, past(noon + minute)).window.weather).toBe(null);
  });
});

describe('the record', () => {
  const snapshot: RoomListening = { nowPlaying: track, recent: [recent('2026-10-26T11:00:00Z')] };
  const empty: RoomListening = { nowPlaying: null, recent: [] };

  // Catches a record turning on a build's snapshot, on fixtures, on an answer the latest refresh
  // did not bring, past its limit by a millisecond, or in the past.
  it.each([
    ['live and current', reading(snapshot, noon, 'live', noon + limit), live(noon), 'playing'],
    ['on the limit', reading(snapshot, noon, 'live', noon + limit), live(noon + limit), 'playing'],
    ['past it', reading(snapshot, noon, 'live', noon + limit), live(noon + limit + 1), 'resting'],
    ['not current', reading(snapshot, noon, 'live', null), live(noon), 'resting'],
    ['the build', reading(snapshot, noon, 'build', noon + limit), live(noon), 'resting'],
    ['fixtures', reading(snapshot, noon, 'sample', noon + limit), live(noon), 'resting'],
    ['past', reading(snapshot, noon, 'live', noon + limit), past(noon + 1), 'resting'],
  ] as const)('%s', (_, listening, moment, state) => {
    expect(roomState(inputs({ listening }), moment).record.state).toBe(state);
  });

  // Catches a past moment showing a track from after it, as `nowPlaying` prefers the current one
  // and dates it when the answer was taken.
  it('never reaches past its moment', () => {
    const listening = reading(
      {
        nowPlaying: track,
        recent: [recent('2026-10-26T11:30:00Z', 'Newer'), recent('2026-10-26T09:00:00Z', 'Older')],
      },
      noon,
      'live',
      noon + limit
    );
    const at = past(Date.parse('2026-10-26T10:00:00Z'));
    expect(roomState(inputs({ listening }), at).record).toMatchObject({
      state: 'resting',
      words: 'Last played Older by Nick Drake · 26 Oct, 09:00',
    });
    const before = past(Date.parse('2026-10-26T08:00:00Z'));
    expect(roomState(inputs({ listening }), before).record).toEqual({
      state: 'unknown',
      line: null,
      words: null,
    });
  });

  // Catches a hotspot making a present claim from an old empty answer the panel dates: the build's,
  // one aged past its limit, and one a failed refresh left in place.
  it.each([
    ['the build', reading(empty), live(noon + dayMs)],
    ['an aged answer', reading(empty, noon, 'live', noon + limit), live(noon + limit + 1)],
    ['a failed refresh', reading(empty, noon, 'live', null), live(noon + minute)],
  ] as const)('dates an empty record from %s', (_, listening, moment) => {
    const state = roomState(inputs({ listening }), moment);
    expect(hotspotWords(roomObjects[6], state)).toBe(
      'Record player: music. Nothing played lately · checked 26 Oct, 12:00.'
    );
  });

  // Catches a date on a line that describes now.
  it('needs no date while it describes now', () => {
    const listening = reading(empty, noon, 'live', noon + limit);
    expect(roomState(inputs({ listening }), live()).record.words).toBe('Nothing playing right now');
    const playing = reading(snapshot, noon, 'live', noon + limit);
    expect(roomState(inputs({ listening: playing }), live()).record.words).toBe(
      'Now playing Which Will by Nick Drake'
    );
  });

  // Catches an accepted answer turning the record after a later refresh that was not current: the
  // answer kept is young and looks fine, and only the refresh's outcome says otherwise. The body
  // here runs the real reader, and the record follows what `live()` tells its renderer.
  const body = (nowPlaying: unknown, at: number, stale = false) => ({
    source: 'listening',
    version: 1,
    stale,
    fetchedAt: iso(at),
    data: {
      ...(snapshotFixtures.listening.ok as ListeningSnapshot),
      nowPlaying,
    },
  });
  const a = body(track, noon);
  it.each([
    ['an older answer', body(track, noon - minute)],
    ['a stale answer', body(track, noon + minute, true)],
    ['no data', { ...a, data: null }],
    ['a malformed answer', { ...a, data: { nowPlaying: 3 } }],
  ])('stops turning on %s', (_, next) => {
    const refresh = follow('listening', limit, readListening, undefined);
    const stateAfter = (answer: unknown, time: number) => {
      const { shown, now } = refresh(answer, time, false);
      const accepted = { ...shown, data: shown.data as ListeningSnapshot };
      const listening = liveReading(accepted, now ? shown.at + limit : null);
      return roomState(inputs({ listening }), live(time)).record;
    };
    expect(stateAfter(a, noon).state).toBe('playing');
    const after = stateAfter(next, noon + minute);
    expect(after.state).toBe('resting');
    expect(after.words).toBe('Last played Which Will by Nick Drake · 26 Oct, 12:00');
  });

  // The rule as a sequence: whatever a tab sees, in any order, restarts included.
  // Catches any path through the reader that leaves the record turning on an answer the latest
  // refresh did not bring, or past the limit.
  it('turns only on what the latest refresh brought, over generated runs', () => {
    const next = seeded(43);
    for (let run = 0; run < 200; run++) {
      let refresh = follow<ListeningSnapshot>('listening', limit, readListening, iso(noon));
      let time = noon;
      let listening: RoomInputs['listening'] = null;
      for (let step = 0; step < 30; step++) {
        time += next(20) * minute;
        const kind = next(7);
        if (kind === 6) {
          refresh = follow('listening', limit, readListening, iso(noon));
          listening = null;
        }
        const taken = time - next(10) * minute;
        const answer = [
          body(track, taken),
          body(track, taken, true),
          body(null, taken),
          body(track, time - 30 * minute),
          { ...a, data: null },
          { ...a, data: { nowPlaying: 3 } },
          undefined,
        ][kind];
        const { shown, now } = refresh(answer, time, answer === undefined);
        if (shown.data !== undefined) {
          listening = liveReading({ ...shown, data: shown.data }, now ? shown.at + limit : null);
        }
        const { state } = roomState(inputs({ listening }), live(time)).record;
        if (state === 'playing') {
          expect(now).toBe(true);
          expect(shown.data?.nowPlaying).toEqual(track);
          expect(time - shown.at).toBeLessThanOrEqual(limit);
        }
      }
    }
  });
});

describe('the shelf', () => {
  const posts = (count: number): RoomPost[] =>
    Array.from({ length: count }, (_, index) => ({
      title: `Post ${index + 1}`,
      date: new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10),
    }));

  // Catches a Notebook that says what the shelf does not, and a post dated after the moment on it.
  it('counts what it holds, newest title first', () => {
    const list = [...posts(3), { title: 'Tomorrow', date: '2026-10-27' }];
    const state = roomState(inputs({ posts: list }), live());
    expect(state.shelf.words).toBe('3 posts, newest: Post 3');
    expect(hotspotWords(roomObjects[2], state)).toBe('Notebook: writing. 3 posts, newest: Post 3.');
    expect(roomState(inputs(), live()).shelf).toEqual({ books: [], words: 'No posts yet' });
  });

  // Catches a new post recolouring or moving the spines already on the shelf, or the cap counting
  // the shelf instead of the writing.
  it('keeps every spine where it was, and counts past the cap', () => {
    const next = seeded(7);
    for (let run = 0; run < 50; run++) {
      const count = next(shelfSlots);
      const before = roomState(inputs({ posts: posts(count) }), live()).shelf.books;
      const after = roomState(inputs({ posts: posts(count + 1) }), live()).shelf.books;
      expect(after.slice(0, count)).toEqual(before);
    }
    const shelf = roomState(inputs({ posts: posts(30) }), live()).shelf;
    expect(shelf.books).toHaveLength(shelfSlots);
    expect(shelf.books.at(-1)?.title).toBe('Post 30');
    expect(shelf.words).toBe('30 posts, newest: Post 30');
  });
});

describe('the corkboard', () => {
  // Catches 44 merges in a day taking every note, the biggest event not winning a repository's
  // day, an empty push drawn as work, and stars on the board.
  it('pins a repository once a day, by what mattered most', () => {
    const events: ShippingEvent[] = [
      push('ayagmar/a', '2026-10-26T11:00:00Z'),
      merge('ayagmar/a', '2026-10-26T10:00:00Z'),
      {
        type: 'release',
        repo: 'ayagmar/a',
        at: '2026-10-26T09:00:00Z',
        url: 'https://github.com/ayagmar/a/releases/1',
        tag: 'v1',
      },
      push('ayagmar/b', '2026-10-26T08:00:00Z', 0),
      { type: 'stars', repo: 'ayagmar/c', at: '2026-10-26T08:00:00Z', gained: 2, total: 9 },
      merge('ayagmar/a', '2026-10-25T23:00:00Z'),
    ];
    const { pins, latest, words } = roomState(
      inputs({ shipping: reading({ events }) }),
      live()
    ).pins;
    expect(pins).toEqual([
      { repo: 'ayagmar/a', date: '2026-10-26', kind: 'release', count: 3 },
      { repo: 'ayagmar/a', date: '2026-10-25', kind: 'merge', count: 1 },
    ]);
    expect(latest).toEqual(events[0]);
    expect(words).toBe('Shipped to a on 26 Oct');
  });

  // Catches a past moment showing what shipped after it, or calling an empty list a quiet time:
  // the snapshot holds only the newest events.
  it('tells unknown from empty', () => {
    const shipping = reading({ events: [merge('ayagmar/a', '2026-10-26T10:00:00Z')] });
    expect(roomState(inputs({ shipping }), past(noon - 3 * 3_600_000)).pins.words).toBe(null);
    expect(roomState(inputs(), live()).pins.words).toBe(null);
    expect(roomState(inputs({ shipping: reading({ events: [] }) }), live()).pins.words).toBe(
      'Nothing shipped lately, as of 26 Oct'
    );
  });
});

describe('the framed screen', () => {
  const usage = (rows: [string, number][], at = noon, monthTokens: number | null = null) =>
    reading({ days: rows.map(([date, totalTokens]) => ({ date, totalTokens })), monthTokens }, at);

  // Catches a missing day drawn as a quiet day, a recorded zero lost, and a screen that ends
  // after what it observed.
  it('ends on the day it observed, and keeps unknown apart from zero', () => {
    const { cells } = roomState(
      inputs({
        usage: usage([
          ['2026-10-24', 0],
          ['2026-10-26', 500],
        ]),
      }),
      live(noon + 3 * dayMs)
    ).screen;
    expect(cells.at(-1)).toEqual({ date: '2026-10-26', level: 1 });
    expect(cells.at(-2)).toEqual({ date: '2026-10-25', level: null });
    expect(cells.at(-3)).toEqual({ date: '2026-10-24', level: 0 });
  });

  // Catches week arithmetic that drops the last Monday or adds a twelfth column, on the days a
  // column starts and ends and across a year's end.
  it.each([
    ['2026-10-26', 71],
    ['2026-11-01', 77],
    ['2027-01-01', 75],
  ])('draws eleven weeks to %s', (date, count) => {
    const at = Date.parse(`${date}T12:00:00Z`);
    const { cells } = roomState(inputs({ usage: usage([[date, 5]], at) }), live(at)).screen;
    expect(cells).toHaveLength(count);
    expect(cells.at(-1)?.date).toBe(date);
    expect(new Date(`${cells[0]?.date}T00:00:00Z`).getUTCDay()).toBe(1);
  });

  const october = (last: number, totalTokens: number) =>
    Array.from({ length: last }, (_, index): [string, number] => [
      `2026-10-${String(index + 1).padStart(2, '0')}`,
      totalTokens,
    ]);

  // Catches sparse days summed into a month's figure: the source's own total is the claim, and an
  // old page must say when it looked, as the day it counts was still running.
  it("says the source's month, as of when it looked", () => {
    const rows: [string, number][] = [['2026-10-26', 300_000]];
    expect(roomState(inputs({ usage: usage(rows, noon, 61_250_000) }), live()).screen.words).toBe(
      '61.3M tokens, 1–26 Oct, as of 26 Oct, 12:00'
    );
  });

  // Catches a sum over missing days passing for the whole period, and a lone recorded zero passing
  // for an unknown month: missing is never zero.
  it.each([
    ['sparse days', [['2026-10-25', 2_000_000]], '2.0M tokens on record, 1–25 Oct'],
    ['one recorded zero', [['2026-10-25', 0]], '0 tokens on record, 1–25 Oct'],
    ['every day held', october(25, 1_000_000), '25.0M tokens, 1–25 Oct'],
    ['every day zero', october(25, 0), '0 tokens, 1–25 Oct'],
    ['nothing held', [['2026-09-25', 5]], null],
  ] as [string, [string, number][], string | null][])(
    'a past moment words %s',
    (_, rows, words) => {
      const usageInput = usage(rows, Date.parse('2026-10-26T18:00:00Z'), 61_250_000);
      const at = past(Date.parse('2026-10-26T09:00:00Z'));
      expect(roomState(inputs({ usage: usageInput }), at).screen.words).toBe(words);
    }
  );

  // Catches a source with no month figure losing its qualifier while its day is open.
  it('qualifies recorded days when the source reports no month', () => {
    expect(
      roomState(inputs({ usage: usage([['2026-10-26', 300_000]]) }), live()).screen.words
    ).toBe('300.0K tokens on record, 1–26 Oct, as of 26 Oct, 12:00');
  });

  // Catches afternoon tokens in a morning: a snapshot at 18:00 holds all of its day, so a past
  // moment that day may show no total for it, and the day before is closed and needs no as-of.
  it('makes no claim about the day a past moment sits inside', () => {
    const rows: [string, number][] = [
      ['2026-10-25', 2_000_000],
      ['2026-10-26', 7_000_000],
    ];
    const evening = Date.parse('2026-10-26T18:00:00Z');
    const { cells, words } = roomState(
      inputs({ usage: usage(rows, evening) }),
      past(Date.parse('2026-10-26T09:00:00Z'))
    ).screen;
    expect(cells.at(-1)).toEqual({ date: '2026-10-26', level: null });
    expect(cells.at(-2)?.level).toBe(1);
    expect(words).toBe('2.0M tokens on record, 1–25 Oct');
  });

  // Catches a Rabat day taken for a UTC one: before 20 September Morocco ran an hour ahead.
  it('dates the observation in Rabat', () => {
    const late = Date.parse('2026-09-10T23:30:00Z');
    const { cells } = roomState(
      inputs({ usage: usage([['2026-09-11', 10]], late) }),
      live(late)
    ).screen;
    expect(rabatDate(late)).toBe('2026-09-11');
    expect(cells.at(-1)).toEqual({ date: '2026-09-11', level: 1 });
  });

  // Catches a framed screen with words and nothing behind them.
  it('stays dark without a record', () => {
    expect(roomState(inputs(), live()).screen).toEqual({ cells: [], words: null });
    const empty = roomState(inputs({ usage: usage([]) }), live()).screen;
    expect(empty.words).toBe(null);
    expect(empty.cells.every(({ level }) => level === null)).toBe(true);
  });
});

describe('the seed', () => {
  const usageSnapshot = snapshotFixtures['llm-usage'].ok as LlmUsageSnapshot;
  const events = Array.from({ length: 40 }, (_, index) =>
    merge(`ayagmar/r${index % 9}`, iso(noon - index * 5 * 3_600_000), index + 1)
  );
  const envelope = <Source, Data>(source: Source, data: Data, at = noon) => ({
    source,
    version: 1 as const,
    fetchedAt: iso(at),
    stale: false,
    data,
  });
  const built = {
    posts: [
      { title: 'Newer', date: '2026-10-02' },
      { title: 'Older', date: '2026-10-01' },
    ],
    shipping: envelope('shipping' as const, { events, starHistory: [] }),
    usage: envelope('llm-usage' as const, usageSnapshot),
    listening: envelope('listening' as const, snapshotFixtures.listening.ok as ListeningSnapshot),
    origin: 'build' as const,
    builtAt: noon,
    listeningLimitMs: limit,
  };
  const seed = roomSeed(built);
  const whole = inputs({
    posts: seed.inputs.posts,
    shipping: reading({ events }),
    usage: reading({
      days: usageSnapshot.days,
      monthTokens: usageSnapshot.monthToDate.totalTokens,
    }),
    listening: reading(built.listening.data),
  });

  // Catches the trimming that keeps the seed small changing what the room says.
  it('says what the whole snapshots say', () => {
    const moment: RoomMoment = { kind: 'built', instant: noon };
    expect(roomState(seededInputs(seed, true), moment)).toEqual(roomState(whole, moment));
  });

  // Catches an old observation trimmed by the build's clock: when the producer stops, the screen
  // keeps its dated days, on a Sunday (the fullest last column) and past twelve weeks too.
  it.each([
    ['a week old', '2026-10-26T12:00:00Z', 7],
    ['an old Sunday', '2026-10-25T12:00:00Z', 30],
    ['past twelve weeks', '2026-10-26T12:00:00Z', 120],
  ])('keeps the screen of an observation %s', (_, taken, buildDaysLater) => {
    const at = Date.parse(taken);
    const days = Array.from({ length: 100 }, (_row, index) => ({
      ...usageSnapshot.days[0],
      date: new Date(at - index * dayMs).toISOString().slice(0, 10),
      totalTokens: (index + 1) * 1000,
      costUsd: null,
    }));
    const data = { ...usageSnapshot, days } as LlmUsageSnapshot;
    const builtAt = at + buildDaysLater * dayMs;
    const seedLater = roomSeed({ ...built, builtAt, usage: envelope('llm-usage' as const, data, at) });
    const moment: RoomMoment = { kind: 'built', instant: builtAt };
    const seededScreen = roomState(seededInputs(seedLater, true), moment).screen;
    const wholeUsage = reading({ days, monthTokens: data.monthToDate.totalTokens }, at);
    expect(seededScreen).toEqual(roomState(inputs({ usage: wholeUsage }), moment).screen);
    expect(seededScreen.cells.filter(({ level }) => level !== null).length).toBeGreaterThan(70);
  });

  const release = (repo: string, at: string): ShippingEvent => ({
    type: 'release',
    repo,
    at,
    url: `https://github.com/${repo}/releases/1`,
    tag: 'v1',
  });
  const hours = (count: number) => iso(noon - count * 3_600_000);
  const seededPins = (feed: ShippingEvent[]) => {
    const shipping = { ...built.shipping, data: { events: feed, starHistory: [] } };
    const moment: RoomMoment = { kind: 'built', instant: noon };
    const seededState = roomState(seededInputs(roomSeed({ ...built, shipping }), true), moment);
    const wholeState = roomState({ ...whole, shipping: reading({ events: feed }) }, moment);
    return { seededState, wholeState };
  };
  const repos = [0, 1, 2, 3, 4, 5].map((index) => `ayagmar/r${index}`);

  // Catches trimming that changes a pin: a later release in a kept repository's day must make it
  // a release, however many other days sit between them in the feed.
  it('keeps every event of a pin it keeps', () => {
    const feed = [
      ...repos.map((repo, index) => push(repo, hours(index))),
      push('ayagmar/seventh', hours(7)),
      release('ayagmar/r0', hours(9)),
    ];
    const { seededState, wholeState } = seededPins(feed);
    expect(seededState.pins.pins[0]).toEqual({
      repo: 'ayagmar/r0',
      date: '2026-10-26',
      kind: 'release',
      count: 2,
    });
    expect(seededState.pins).toEqual(wholeState.pins);
  });

  // Catches empty pushes spending the six slots, so real work is dropped and the room says quiet.
  it('counts only what ships towards its six', () => {
    const feed = [...repos.map((repo, index) => push(repo, hours(index), 0)), merge('ayagmar/x', hours(8))];
    const { seededState, wholeState } = seededPins(feed);
    expect(seededState.pins.words).toBe('Shipped to x on 26 Oct');
    expect(seededState.pins).toEqual(wholeState.pins);
  });

  // Catches /room losing its latest commit when the newest pins are all releases.
  it('keeps the newest code event past release-only pins', () => {
    const feed = [
      ...repos.map((repo, index) => release(repo, hours(index))),
      push('ayagmar/older', hours(8)),
    ];
    const { seededState, wholeState } = seededPins(feed);
    expect(seededState.pins.latest).toEqual(feed.at(-1));
    expect(seededState.pins).toEqual(wholeState.pins);
  });

  // Catches any interleaving the three above miss.
  it('pins the same as the whole snapshot over generated feeds', () => {
    const next = seeded(11);
    const makers = [merge, push, (repo: string, at: string) => push(repo, at, 0), release];
    for (let run = 0; run < 300; run++) {
      const feed = Array.from({ length: 50 }, (_, index) => {
        const make = makers[next(4)] as (repo: string, at: string) => ShippingEvent;
        return make(`ayagmar/r${next(9)}`, hours(index * (1 + next(3))));
      }).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
      const { seededState, wholeState } = seededPins(feed);
      expect(seededState.pins).toEqual(wholeState.pins);
    }
  });

  // Catches a cost reaching the page's HTML through the seed, or the terminal's JSON (ADR 0014).
  it('carries no cost', () => {
    const text = JSON.stringify(seed);
    expect(usageSnapshot.monthToDate).toHaveProperty('costUsd');
    expect(text).not.toMatch(/costUsd|cacheSavingsUsd/);
    expect(JSON.stringify(roomState(seededInputs(seed, true), live()))).not.toMatch(/cost/i);
  });

  // Catches a page that marks nothing as a sample, or real data marked as one.
  it('marks a room with any fixture in it as a sample', () => {
    const sample = roomSeed({ ...built, origin: 'sample' });
    expect(roomState(seededInputs(sample, true), live()).sample).toBe(true);
    expect(roomState(seededInputs(seed, true), live()).sample).toBe(false);
    const mixed = seededInputs(sample, true);
    mixed.listening = liveReading(
      { data: { nowPlaying: track, recent: [] }, fetchedAt: iso(noon), at: noon, stale: false },
      noon + limit
    );
    expect(roomState(mixed, live())).toMatchObject({
      sample: true,
      record: { state: 'playing' },
    });
  });

  // Catches a renderer that keeps a part from before: live, then a past day with no record of the
  // track or the usage, then live. Each state stands alone, whichever renderer drew the last one.
  it('leaves nothing behind between moments', () => {
    const room = seededInputs(seed, true);
    room.listening = liveReading(
      { data: { nowPlaying: track, recent: [] }, fetchedAt: iso(noon), at: noon, stale: false },
      noon + limit
    );
    const now = roomState(room, live());
    const before = roomState(room, past(noon - 300 * dayMs));
    expect(before.record).toEqual({ state: 'unknown', line: null, words: null });
    expect(before.screen.words).toBe(null);
    expect(before.pins.pins).toEqual([]);
    expect(changedParts(now, before)).toEqual(
      expect.arrayContaining(['window', 'lamp', 'shelf', 'pins', 'screen', 'record'])
    );
    expect(changedParts(now, roomState(room, live()))).toEqual([]);
  });
});
