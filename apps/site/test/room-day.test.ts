import { daysFixtures, historyFixtures } from '@min7/contracts/fixtures';
import { rabatDate } from '@min7/contracts/rabat';
import { describe, expect, it } from 'vitest';
import {
  type Block,
  dateTitle,
  dayFacts,
  dayInstant,
  type Held,
  type Lookup,
  monthsFor,
  readBlock,
  type Series,
} from '../src/lib/room-day.ts';
import { type RoomInputs, roomState } from '../src/lib/room-state.ts';
import { isoDate, utcDate } from '../src/lib/words.ts';

// A past date's facts (ADR 0044), through `dayFacts` and `readBlock`, over the shared fixtures.
const now = Date.parse('2026-11-06T12:00:00Z');

const body = (series: Series, month: string) => ({
  source: series,
  version: 1,
  fetchedAt: '2026-10-26T09:00:00Z',
  stale: false,
  data: {
    days: [...historyFixtures[series].ok.days, ...daysFixtures[series].ok.days].filter(({ date }) =>
      date.startsWith(month)
    ),
  },
});

const fixtures = ((series: Series, month: string) =>
  readBlock(series, month, body(series, month), now) as Held<never>) as Lookup;

const with_ = (series: Series, held: Held<never>): Lookup =>
  ((name: Series, month: string) => (name === series ? held : fixtures(name, month))) as Lookup;

const inputs: RoomInputs = {
  knowsRabat: true,
  posts: [],
  shipping: null,
  usage: null,
  listening: null,
  weather: undefined,
};

describe('a past date', () => {
  // Catches a date's words going through two wordings, or a closed day read as still running.
  it('says what the date came to, in one sentence per object', () => {
    const facts = dayFacts('2026-10-16', fixtures);
    expect(facts.record.state).toBe('resting');
    expect(facts.record.words).toMatch(
      /^Last played .+ by .+ · 16 Oct, \d\d:\d\d\. \d+ plays on 16 Oct$/
    );
    expect(facts.screen.words).toMatch(/ tokens on record for 16 Oct$/);
    expect(facts.pins.words).toMatch(/ on record for 16 Oct, UTC$/);
  });

  // Catches a scrobble reading as a claim about now: the fixture's newest track, from a block
  // that was asked while the date was open, on any date.
  it('is never playing', () => {
    for (const { date } of daysFixtures.listening.ok.days) {
      expect(dayFacts(date, fixtures).record.state).not.toBe('playing');
      expect(dayFacts(date, fixtures).record.line?.playing ?? false).toBe(false);
    }
  });

  // Catches an open day's count passing for what the day came to.
  it('says so while its records were still running', () => {
    expect(dayFacts('2026-10-26', fixtures).record.words).toBe(
      'Last played ' +
        `${daysFixtures.listening.ok.days.at(-1)?.last?.track} by ` +
        `${daysFixtures.listening.ok.days.at(-1)?.last?.artist} · 26 Oct, 08:12. ` +
        '4 plays on 26 Oct, so far, as of 26 Oct, 09:00'
    );
  });

  // Catches a morning's row read as the whole day once the source moves on: pushes rewrite only
  // the newest 35 days, so a row can stay partial under a block fetched months later.
  it('never reads a whole day into a row a newer snapshot left alone', () => {
    const usage = { date: '2026-10-16', totalTokens: 0 };
    const counts = { pushes: 0, commits: 0, merges: 0, releases: 0, stars: 0 };
    const shippingDay = { date: '2026-10-16', ...counts, repos: [], reposComplete: true };
    const later = (series: Series, day: unknown) =>
      readBlock(
        series,
        '2026-10',
        {
          ...body(series, '2026-10'),
          fetchedAt: '2026-12-20T09:00:00Z',
          data: { days: [day] },
        },
        Date.parse('2026-12-20T12:00:00Z')
      ) as Held<never>;
    const held = ((series: Series, month: string) => {
      if (series === 'llm-usage') return later(series, usage);
      return series === 'shipping-activity' ? later(series, shippingDay) : fixtures(series, month);
    }) as Lookup;
    const facts = dayFacts('2026-10-16', held);
    expect(facts.screen.words).toBe('0 tokens on record for 16 Oct');
    expect(facts.pins.words).toBe('Nothing shipped on record for 16 Oct, UTC');
  });

  // Catches a checked zero and a missing row collapsing into one, or a failed read into either:
  // only the zero may say nothing happened.
  it.each([
    ['a checked zero', '2026-10-14', 'resting', 'Nothing played on 14 Oct'],
    ['a date with no row', '2026-10-20', 'unknown', 'No listening on record for 20 Oct'],
  ])('tells %s', (_, date, state, words) => {
    expect(dayFacts(date, fixtures).record).toEqual({ state, line: null, words });
  });

  // Catches one source's failure spreading to the others, or reading as "nothing happened".
  it('leaves only the failed part unknown', () => {
    const facts = dayFacts('2026-10-16', with_('listening', 'failed'));
    expect(facts.record).toEqual({
      state: 'unknown',
      line: null,
      words: 'Listening for 16 Oct could not be read',
    });
    expect(facts.pins.words).toBe(dayFacts('2026-10-16', fixtures).pins.words);
    expect(facts.weatherWords).toBe(dayFacts('2026-10-16', fixtures).weatherWords);
  });

  // Catches "no record" said of a month that has not been answered yet.
  it('claims nothing while it is being read', () => {
    const waiting = dayFacts('2026-10-16', () => 'waiting');
    expect(waiting.pins.words).toBe(null);
    expect(waiting.screen.words).toBe(null);
    expect(waiting.record.words).toBe(null);
    expect(waiting.weatherWords).toBe(undefined);
  });

  // Catches a repository's day with a hidden name drawing an empty board under words that say
  // something shipped (ADR 0038 withholds names, not counts).
  it('pins a day whose repositories are withheld', () => {
    const day = {
      date: '2026-10-16',
      pushes: 1,
      commits: 3,
      merges: 2,
      releases: 0,
      stars: 0,
      repos: [],
      reposComplete: false,
    };
    const held: Block<never> = { days: [day as never] };
    const { pins, words } = dayFacts('2026-10-16', with_('shipping-activity', held)).pins;
    expect(pins).toEqual([{ repo: '', date: '2026-10-16', kind: 'merge', count: 3 }]);
    expect(words).toBe('2 merges · 3 commits in 1 push on record for 16 Oct, UTC');
  });

  // Catches stars or an empty push pinned as shipping: neither is work.
  it('keeps stars and empty pushes off the board', () => {
    const counts = { pushes: 1, commits: 0, merges: 0, releases: 0, stars: 4 };
    const day = {
      date: '2026-10-16',
      ...counts,
      repos: [{ repo: 'ayagmar/a', ...counts }],
      reposComplete: true,
    };
    const held: Block<never> = { days: [day as never] };
    const { pins, words } = dayFacts('2026-10-16', with_('shipping-activity', held)).pins;
    expect(pins).toEqual([]);
    expect(words).toBe('Nothing shipped on record for 16 Oct, UTC');
  });
});

describe('the window on a past date', () => {
  const at = (date: string) => {
    const day = dayFacts(date, fixtures);
    return roomState(inputs, { kind: 'past', instant: dayInstant(date), day }).window;
  };

  // Catches the 13:00 reading painted on a window drawn after dark, or a null slot painted clear.
  it('shows only the night reading', () => {
    expect(daysFixtures.weather.ok.days.find((d) => d.date === '2026-10-14')?.day).not.toBe(null);
    expect(at('2026-10-14').weather).toBe(null);
    expect(at('2026-10-14').label).toMatch(/no weather on record\.$/);
  });

  // Catches a code the table does not know drawn as some state; ADR 0029 shows none.
  it('treats a code it does not know as unknown', () => {
    expect(at('2026-10-15').weather).toBe(null);
    expect(at('2026-10-15').label).toMatch(/no weather on record\.$/);
  });

  // Catches an archived reading passing for one signals took live (ADR 0038).
  it('names the archive', () => {
    expect(at('2026-09-05').label).toMatch(/at 22:00, from Open-Meteo's archive\.$/);
  });
});

describe('the hour of a past date', () => {
  // Catches a fixed offset: before 20 September 2026 Rabat ran at +01, and an hour off near
  // midnight would draw another date. Every date a scrub can reach, across both offsets and the
  // Ramadan changes.
  it('falls on the date itself, at 21:00 in Rabat, on every date', () => {
    for (let time = utcDate('2025-01-01'); time <= utcDate('2026-11-06'); time += 86_400_000) {
      const date = isoDate(time);
      expect(rabatDate(dayInstant(date))).toBe(date);
    }
    expect(new Date(dayInstant('2026-09-10')).toISOString()).toBe('2026-09-10T20:00:00.000Z');
    expect(new Date(dayInstant('2026-10-10')).toISOString()).toBe('2026-10-10T21:00:00.000Z');
  });
});

describe('the months a date needs', () => {
  // Catches a screen drawn from too few months: eleven weeks from a Sunday reach the fourth.
  it('covers every week of the framed screen', () => {
    const usage = monthsFor('2026-10-25').filter(([series]) => series === 'llm-usage');
    expect(usage.map(([, month]) => month).sort()).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(monthsFor('2026-10-25').filter(([series]) => series !== 'llm-usage')).toEqual([
      ['shipping-activity', '2026-10'],
      ['listening', '2026-10'],
      ['weather', '2026-10'],
    ]);
  });
});

describe('a block', () => {
  const month = '2026-10';

  // Catches the hand-written checks drifting from the contract: every fixture day passes.
  it.each(['shipping-activity', 'llm-usage', 'listening', 'weather'] as const)(
    'accepts %s as the contract states it',
    (series) => {
      expect(readBlock(series, month, body(series, month), now)?.days.length).toBe(
        daysFixtures[series].ok.days.filter(({ date }) => date.startsWith(month)).length
      );
    }
  );

  // Catches a cost reaching the browser's room: only the seed's fields may enter (ADR 0014).
  it('keeps no cost', () => {
    const block = readBlock('llm-usage', month, body('llm-usage', month), now);
    expect(JSON.stringify(block)).not.toContain('costUsd');
  });

  // Catches a part of a month accepted as the whole, which would turn days into "no record".
  it.each([
    ['another source', { source: 'weather' }],
    ['a future answer', { fetchedAt: '2026-11-07T12:00:00Z' }],
    ['no data', { data: null }],
    ['a bad day', { data: { days: [{ date: '2026-10-16', count: -1 }] } }],
    ['another month', { data: { days: [{ date: '2026-09-16', count: 0, last: null }] } }],
  ])('refuses %s', (_, over) => {
    expect(readBlock('listening', month, { ...body('listening', month), ...over }, now)).toBe(
      undefined
    );
  });
});

describe('the date in words', () => {
  // Catches a year dropped on a date from another: the range runs over more than one.
  it('names the year only when it is not this one', () => {
    expect(dateTitle('2026-10-14', '2026-11-06')).toBe('Wednesday 14 October');
    expect(dateTitle('2025-12-31', '2026-11-06')).toBe('Wednesday 31 December 2025');
  });
});
