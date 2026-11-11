// Year pages (src/lib/years.ts): which years get a page and what each may claim, over histories
// generated with failed months, empty series, the two zones and the calendar's edges.
import type { LlmUsageDay, ShippingActivityDay } from '@min7/contracts';
import { describe, expect, it } from 'vitest';
import type { Published } from '../src/lib/days.ts';
import { type YearHistory, type YearPage, yearPages } from '../src/lib/years.ts';

const repo = 'ayagmar/runnerd';
/** A UTC shipping day with `pushes` pushes, all in one repository. */
const shipped = (date: string, pushes = 1, complete = true): ShippingActivityDay => {
  const counts = { pushes, commits: pushes * 2, merges: 0, releases: 0, stars: 0 };
  return {
    date,
    ...counts,
    repos: pushes === 0 ? [] : [{ repo, ...counts }],
    reposComplete: complete,
  };
};
const used = (date: string, totalTokens: number, activeMs?: number): LlmUsageDay => ({
  date,
  costUsd: null,
  totalTokens,
  ...(activeMs === undefined ? {} : { activeMs }),
});
/** The dates from `from` through `to`, UTC. */
function run(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += 86_400_000) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  return dates;
}
const fetchedAt = '2026-10-26T09:00:00Z';
const history = (
  shipping: ShippingActivityDay[],
  usage: LlmUsageDay[] = [],
  failed: { shipping?: string[]; usage?: string[] } = {}
): YearHistory => ({
  shipping: { days: shipping, failed: failed.shipping ?? [], fetchedAt },
  usage: { days: usage, failed: failed.usage ?? [], fetchedAt },
});
const after = new Date('2028-06-01T12:00:00Z');
const none = new Set<string>();

function page(pages: YearPage[], year: string): YearPage {
  const found = pages.find((entry) => entry.year === year);
  if (found === undefined) throw new Error(`no page for ${year}`);
  return found;
}
function calendar(entry: YearPage) {
  if (entry.shipping.empty !== null) throw new Error(entry.shipping.empty);
  return entry.shipping;
}
function usage(entry: YearPage) {
  if (entry.usage.empty !== null) throw new Error(entry.usage.empty);
  return entry.usage;
}
const facts = (list: { label: string; value: { text: string }[] }[]) =>
  Object.fromEntries(
    list.map((fact) => [fact.label, fact.value.map((part) => part.text).join('')])
  );

describe('which years have a page', () => {
  // Catches a year with no history built as an empty page, and a link to a year without one.
  it('skips a year with nothing and links the years that exist, across the gap', () => {
    const pages = yearPages(
      history([shipped('2025-03-01')], [], {}),
      [{ date: '2027-02-02', title: 'A', path: '/writing/a', kind: 'Post' }],
      after,
      none
    );
    expect(pages.map((entry) => entry.year)).toEqual(['2025', '2027']);
    expect(page(pages, '2025').next).toEqual({ path: '/2027', title: '2027' });
    expect(page(pages, '2027').previous).toEqual({ path: '/2025', title: '2025' });
    expect(page(pages, '2025').previous).toBeNull();
    expect(page(pages, '2027').next).toBeNull();
  });

  // Catches signals being down at build time removing pages that search already has, and such a
  // page being indexed with nothing on it.
  it('keeps a year whose months all failed, says so, and marks it as having nothing to read', () => {
    const months = ['2025-01', '2025-02'];
    const [only] = yearPages(history([], [], { shipping: months, usage: months }), [], after, none);
    expect(only).toMatchObject({
      year: '2025',
      hasContent: false,
      shipping: { empty: 'Shipping history could not be read when this page was built.' },
      usage: { empty: 'Agent usage history could not be read when this page was built.' },
    });
  });
});

describe('the calendar', () => {
  // Catches a leap day dropped or a 29 February invented, and the first day of a month in the
  // wrong column, which shifts every week of that month. 1 Jan 2024 is a Monday, 1 Feb a
  // Thursday, 1 Sep 2024 a Sunday; 1 Jan 2025 a Wednesday, so its week starts in 2024.
  it('lays each month out in Monday-first weeks, with the right number of days', () => {
    const pages = yearPages(
      history([
        shipped('2024-01-01'),
        shipped('2024-02-29'),
        shipped('2025-01-01'),
        shipped('2025-02-28'),
      ]),
      [],
      after,
      none
    );
    const leap = calendar(page(pages, '2024')).months;
    const plain = calendar(page(pages, '2025')).months;
    expect(leap.map((month) => month.cells?.length)).toEqual([
      31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
    ]);
    expect(plain[1]?.cells).toHaveLength(28);
    expect([leap[0]?.column, leap[1]?.column, leap[8]?.column, plain[0]?.column]).toEqual([
      1, 4, 7, 3,
    ]);
  });

  // Catches a recorded zero drawn as no record, or the other way round, which is the difference
  // between a quiet day and a day nobody knows about.
  it('tells a recorded zero from a day without a record, and links only days with a page', () => {
    const pages = yearPages(
      history([shipped('2026-03-01', 0), shipped('2026-03-02', 5)]),
      [],
      after,
      new Set(['2026-03-02'])
    );
    const march = calendar(page(pages, '2026')).months[0]?.cells;
    expect(march?.slice(0, 3)).toEqual([
      { date: '2026-03-01', level: 0, label: '1 Mar: nothing shipped', page: false },
      {
        date: '2026-03-02',
        level: 1,
        label: '2 Mar: 5 pushes, merges and releases',
        page: true,
      },
      { date: '2026-03-03', level: null, label: '3 Mar: no record', page: false },
    ]);
  });

  // Catches a year that began being recorded in October opening on nine empty months, and a month
  // that failed to load being dropped when it comes first: it may hold records (ADR 0041).
  it('opens on the first month with a record or a failed read, in each series', () => {
    const recorded = history([shipped('2026-10-03')], [used('2026-09-30', 10)]);
    const entry = page(yearPages(recorded, [], after, none), '2026');
    expect(calendar(entry).months[0]?.name).toBe('October');
    expect(usage(entry).rows[0]?.name).toBe('September');

    const unread = history([shipped('2026-10-03')], [], { shipping: ['2026-08'] });
    const months = calendar(page(yearPages(unread, [], after, none), '2026')).months;
    expect(months.slice(0, 3).map((month) => [month.name, month.cells === null])).toEqual([
      ['August', true],
      ['September', false],
      ['October', false],
    ]);
  });

  // Catches squares or zeros for days that have not happened, and "the year" said of a year
  // still running.
  it('stops at the build date and says so far in the current year', () => {
    const now = new Date('2026-03-15T12:00:00Z');
    const entry = page(yearPages(history([shipped('2026-03-10')]), [], now, none), '2026');
    const { months, facts: listed } = calendar(entry);
    expect(months.map((month) => month.name)).toEqual(['March']);
    expect(months[0]?.cells?.at(-1)?.date).toBe('2026-03-15');
    expect(listed.map((fact) => fact.label)).toEqual([
      'Shipped on record so far',
      'Busiest day on record so far',
      'Longest run on record so far',
      'Busiest month on record so far',
      'Top repositories on record so far',
    ]);
    expect(entry.description).toBe(
      'What shipped, how much the coding agents ran, and what was published in 2026 so far.'
    );
  });

  // Catches one "today" used for both series: at 23:30 UTC on 31 December 2025 it was already
  // 2026 in Rabat (+01 until 20 September 2026, ADR 0030), so usage has a new year while
  // shipping's is still the old one.
  it('runs each series to its own today across New Year', () => {
    const now = new Date('2025-12-31T23:30:00Z');
    const pages = yearPages(
      history([shipped('2025-12-31')], [used('2026-01-01', 1_000)]),
      [],
      now,
      none
    );
    expect(pages.map((entry) => entry.year)).toEqual(['2025', '2026']);
    expect(usage(page(pages, '2026')).rows).toEqual([
      { name: 'January', state: 'recorded', tokens: '1.0K', time: null, days: '1' },
    ]);
    expect(page(pages, '2026').shipping).toEqual({ empty: 'No shipping recorded in 2026.' });
    expect(calendar(page(pages, '2025')).facts[0]?.label).toBe('Shipped on record so far');
  });
});

describe('facts', () => {
  // Catches the wrong day or month picked as busiest, a tie going to the later one, and a day
  // without a record or a recorded zero counted as part of a run.
  it('counts the busiest day, the busiest month and the longest run', () => {
    const days = [
      ...run('2025-03-01', '2025-03-03').map((date) => shipped(date, 2)),
      // 4 March has no record, so the run ends on the 3rd.
      ...run('2025-03-05', '2025-03-06').map((date) => shipped(date, 1)),
      shipped('2025-04-01', 2),
      shipped('2025-04-02', 0),
      shipped('2025-04-03', 1),
    ];
    const [only] = yearPages(history(days), [], after, new Set(['2025-03-01']));
    const { facts: listed, notes } = calendar(only as YearPage);
    expect(facts(listed)).toEqual({
      'Shipped on record': '22 commits in 11 pushes on 7 days',
      'Busiest day on record': '1 Mar 2025: 2 pushes, merges and releases',
      'Longest run on record': '3 days, 1–3 Mar 2025',
      'Busiest month on record': 'March: 8 pushes, merges and releases',
      'Top repositories on record': 'runnerd (11)',
    });
    expect(listed[1]?.value[0]).toEqual({ text: '1 Mar 2025', path: '/day/2025-03-01' });
    expect(notes).toEqual(['Counted over 8 recorded days of 365; the rest have no record.']);
  });

  // Catches one recorded zero read as a quiet year: the days around it are unknown, and only a
  // year recorded whole may say nothing shipped.
  it('says nothing shipped only of a year recorded whole', () => {
    const whole = run('2025-01-01', '2025-12-31').map((date) => shipped(date, 0));
    const [full] = yearPages(history(whole), [], after, none);
    expect(facts(calendar(full as YearPage).facts)).toEqual({ Shipped: 'Nothing shipped.' });
    expect(calendar(full as YearPage).notes).toEqual([]);

    const [thin] = yearPages(history([shipped('2025-03-01', 0)]), [], after, none);
    expect(facts(calendar(thin as YearPage).facts)).toEqual({
      'Shipped on record': 'Nothing shipped on recorded days.',
    });
    expect(calendar(thin as YearPage).notes).toEqual([
      'Counted over 1 recorded day of 365; the rest have no record.',
    ]);
  });

  // Catches one recorded day crowned the year's busiest, and a whole year qualified for nothing.
  it('marks facts as on record unless every elapsed date has a record', () => {
    const [thin] = yearPages(history([shipped('2025-03-01', 4)]), [], after, none);
    expect(facts(calendar(thin as YearPage).facts)).toEqual({
      'Shipped on record': '8 commits in 4 pushes on 1 day',
      'Busiest day on record': '1 Mar 2025: 4 pushes, merges and releases',
      'Longest run on record': '1 day, 1 Mar 2025',
      'Busiest month on record': 'March: 4 pushes, merges and releases',
      'Top repositories on record': 'runnerd (4)',
    });
    const whole = run('2025-01-01', '2025-12-31').map((date) => shipped(date));
    const [full] = yearPages(history(whole), [], after, none);
    expect(facts(calendar(full as YearPage).facts)).toMatchObject({
      'Busiest day': '1 Jan 2025: 1 push, merge or release',
      'Longest run': '365 days, 1 Jan–31 Dec 2025',
    });
  });

  // Catches a row dated after the build counted though its square is not drawn: signals serves
  // what a month has stored, and a clock a few minutes ahead can store tomorrow.
  it('counts nothing dated after the build, in either series', () => {
    const now = new Date('2026-11-06T23:58:00Z');
    const pages = yearPages(
      history(
        [shipped('2026-11-06', 1), shipped('2026-11-07', 9), shipped('2027-01-01', 9)],
        [used('2026-11-06', 1_000, 3_600_000), used('2026-11-07', 9_000_000, 36_000_000)]
      ),
      [],
      now,
      none
    );
    expect(pages.map((entry) => entry.year)).toEqual(['2026']);
    const [only] = pages;
    expect(facts(calendar(only as YearPage).facts)).toEqual({
      'Shipped on record so far': '2 commits in 1 push on 1 day',
      'Busiest day on record so far': '6 Nov 2026: 1 push, merge or release',
      'Longest run on record so far': '1 day, 6 Nov 2026',
      'Busiest month on record so far': 'November: 1 push, merge or release',
      'Top repositories on record so far': 'runnerd (1)',
    });
    const { rows, total, facts: listed } = usage(only as YearPage);
    expect(rows.at(-1)).toEqual({
      name: 'November',
      state: 'recorded',
      tokens: 'at least 1.0K',
      time: 'at least 1 hour',
      days: 'at least 1',
    });
    expect(total).toEqual({
      name: 'On record',
      state: 'recorded',
      tokens: 'at least 1.0K',
      time: 'at least 1 hour',
      days: 'at least 1',
    });
    expect(facts(listed)).toEqual({ 'Busiest day on record so far': '6 Nov 2026: 1.0K tokens' });
  });

  // Catches a ranking by commits or stars, which the squares do not count, by one kind alone, a
  // tie settled by input order, and a fourth repository listed.
  it('ranks repositories by pushes, merges and releases, ties by name, three at most', () => {
    const counts = { pushes: 0, commits: 0, merges: 0, releases: 0, stars: 0 };
    const repos = [
      { repo: 'ayagmar/zeta', ...counts, pushes: 1, merges: 1, releases: 1 },
      { repo: 'ayagmar/alpha', ...counts, merges: 3 },
      { repo: 'ayagmar/mixed', ...counts, pushes: 2, merges: 1, releases: 1 },
      { repo: 'ayagmar/stars', ...counts, pushes: 1, commits: 900, stars: 900 },
    ];
    const day: ShippingActivityDay = {
      date: '2025-03-01',
      pushes: 4,
      commits: 900,
      merges: 5,
      releases: 2,
      stars: 900,
      repos,
      reposComplete: true,
    };
    const [only] = yearPages(history([day]), [], after, none);
    expect(facts(calendar(only as YearPage).facts)['Top repositories on record']).toBe(
      'mixed (4), alpha (3), zeta (3)'
    );
  });

  // Catches a run cut at 31 December read as ending there, or one year's page counting the
  // other's days into its length.
  it('counts a run across New Year in each year, and says it goes on', () => {
    const days = run('2025-12-29', '2026-01-02').map((date) => shipped(date));
    const pages = yearPages(history(days), [], after, none);
    expect(facts(calendar(page(pages, '2025')).facts)['Longest run on record']).toBe(
      '3 days, 29–31 Dec 2025, on into 2026'
    );
    expect(facts(calendar(page(pages, '2026')).facts)['Longest run on record']).toBe(
      '2 days, 1–2 Jan 2026, on from 2025'
    );
  });

  // Catches a run or a total claimed over a month nobody could read: the days around it may be
  // one long run, or the unread month may hold the busiest day.
  it('leaves out the facts of a year with an unknown month, and of that year only', () => {
    const days = [
      ...run('2025-05-25', '2025-05-31').map((date) => shipped(date)),
      ...run('2025-07-01', '2025-07-04').map((date) => shipped(date)),
      shipped('2026-01-05'),
    ];
    const pages = yearPages(history(days, [], { shipping: ['2025-06'] }), [], after, none);
    const year = calendar(page(pages, '2025'));
    expect(year.facts).toEqual([]);
    expect(year.notes).toEqual([
      'June could not be read when this page was built, so the totals are left out.',
    ]);
    expect(year.months.find((month) => month.name === 'June')?.cells).toBeNull();
    expect(year.months.find((month) => month.name === 'May')?.cells?.at(-1)?.level).toBe(1);
    expect(facts(calendar(page(pages, '2026')).facts)['Shipped on record']).toBe(
      '2 commits in 1 push on 1 day'
    );
  });

  // Catches a run said to go on into a year whose January nobody read.
  it('does not carry a run into an unknown month', () => {
    const pages = yearPages(
      history([shipped('2025-12-31')], [], { shipping: ['2026-01'] }),
      [],
      after,
      none
    );
    expect(facts(calendar(page(pages, '2025')).facts)['Longest run on record']).toBe(
      '1 day, 31 Dec 2025'
    );
  });

  // Catches top repositories given as the whole story when a day's counts include unnamed ones.
  it('says when the counts include repositories they do not name', () => {
    const [only] = yearPages(history([shipped('2025-03-01', 1, false)]), [], after, none);
    expect(calendar(only as YearPage).notes).toEqual([
      'Counted over 1 recorded day of 365; the rest have no record.',
      'Some of it was in repositories not named here.',
    ]);
  });
});

describe('agent usage', () => {
  // Catches a month without a record shown as 0 tokens, an unset activeMs summed as 0 hours, a
  // missing date's month given as exact, a recorded zero month taken for a gap, and a sum over
  // some days labelled the year.
  it('sums each month in Rabat days, keeping no record and unknown time apart', () => {
    const days = [
      ...run('2025-01-01', '2025-01-31').map((date) => used(date, 100_000, 3_600_000)),
      // 3 February has no record.
      ...run('2025-02-01', '2025-02-02').map((date) => used(date, 500_000, 3_600_000)),
      ...run('2025-02-04', '2025-02-28').map((date) => used(date, 1_000)),
      ...run('2025-03-01', '2025-03-31').map((date) => used(date, 0, 0)),
      used('2025-05-01', 2_000),
    ];
    const entry = usage(page(yearPages(history([], days), [], after, none), '2025'));
    expect(entry.rows.slice(0, 5)).toEqual([
      { name: 'January', state: 'recorded', tokens: '3.1M', time: '31 hours', days: '31' },
      {
        name: 'February',
        state: 'recorded',
        tokens: 'at least 1.0M',
        time: 'at least 2 hours',
        days: 'at least 27',
      },
      { name: 'March', state: 'recorded', tokens: '0', time: '0 hours', days: '0' },
      { name: 'April', state: 'none' },
      { name: 'May', state: 'recorded', tokens: 'at least 2.0K', time: null, days: 'at least 1' },
    ]);
    expect(entry.total).toEqual({
      name: 'On record',
      state: 'recorded',
      tokens: 'at least 4.1M',
      time: 'at least 33 hours',
      days: 'at least 59',
    });
    expect(facts(entry.facts)).toEqual({ 'Busiest day on record': '1 Feb 2025: 500.0K tokens' });
    expect(entry.notes).toEqual(['Counted over 90 recorded days of 365; the rest have no record.']);
  });

  // Catches "the year" withheld from a year recorded whole, or a lower bound said of exact sums.
  it('gives a year recorded whole its exact total', () => {
    const days = run('2025-01-01', '2025-12-31').map((date) => used(date, 1_000, 3_600_000));
    const entry = usage(page(yearPages(history([], days), [], after, none), '2025'));
    expect(entry.total).toEqual({
      name: 'The year',
      state: 'recorded',
      tokens: '365.0K',
      time: '365 hours',
      days: '365',
    });
    expect(entry.notes).toEqual([]);
  });

  // Catches a yearly total over a month that failed to load; shipping must not lose its facts
  // because the other series failed, each year's months are their own series' months.
  it('leaves the total out for an unknown month, without touching shipping', () => {
    const pages = yearPages(
      history([shipped('2025-03-01')], [used('2025-01-05', 100)], { usage: ['2025-02'] }),
      [],
      after,
      none
    );
    const entry = usage(page(pages, '2025'));
    expect(entry.rows[1]).toEqual({ name: 'February', state: 'unknown' });
    expect(entry.total).toBeNull();
    expect(entry.facts).toEqual([]);
    expect(entry.notes).toEqual([
      'February could not be read when this page was built, so the totals are left out.',
    ]);
    expect(facts(calendar(page(pages, '2025')).facts)['Shipped on record']).toBe(
      '2 commits in 1 push on 1 day'
    );
  });
});

describe('published', () => {
  const post = (date: string, title: string): Published => ({
    date,
    title,
    path: `/writing/${title}`,
    kind: 'Post',
  });

  // Catches writing listed under the wrong year, or a year of writing alone treated as empty.
  it('lists a year of writing, newest first, and only that year', () => {
    const pages = yearPages(
      history([]),
      [post('2026-01-01', 'a'), post('2026-12-31', 'b'), post('2025-12-31', 'c')],
      after,
      none
    );
    expect(page(pages, '2026').published.map((entry) => entry.title)).toEqual(['b', 'a']);
    expect(page(pages, '2026').hasContent).toBe(true);
    expect(page(pages, '2026').shipping).toEqual({ empty: 'No shipping recorded in 2026.' });
  });
});

// The rules that hold for any history: a square never lies about what the history says, and no
// claim is made over a month that failed.
describe('generated histories', () => {
  /** A small deterministic generator (mulberry32). */
  function random(seed: number) {
    let state = seed;
    return () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
  }

  // Catches a day drawn in a failed month, after the build date or with another day's count, a
  // total surviving an unknown month, and a page that throws on an odd history.
  it.each(Array.from({ length: 40 }, (_, seed) => seed))('holds for seed %i', (seed) => {
    const next = random(seed + 1);
    const failed = ['2025-02', '2025-12', '2026-01', '2026-03'].filter(() => next() < 0.3);
    const now = new Date(
      Date.UTC(2026, Math.floor(next() * 12), 1 + Math.floor(next() * 28), 23, 30)
    );
    const today = now.toISOString().slice(0, 10);
    const dates = run('2025-01-01', today).filter(
      (date) => next() < 0.5 && !failed.includes(date.slice(0, 7))
    );
    // Pushes, merges and releases in turn, so a level that counts one kind alone is caught.
    const counts = new Map(dates.map((date) => [date, Math.floor(next() * 7)]));
    const days = dates.map((date, index): ShippingActivityDay => {
      const total = counts.get(date) ?? 0;
      const kind = (['pushes', 'merges', 'releases'] as const)[index % 3] ?? 'pushes';
      return { ...shipped(date, 0), [kind]: total, commits: 50, stars: 50 };
    });
    // A row after the build, which no square or count may show.
    days.push(shipped(new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10), 6));
    const tokenDays = dates.map((date) => used(date, Math.floor(next() * 3) * 1000));
    const pages = yearPages(
      history(days, tokenDays, { shipping: failed, usage: failed }),
      [],
      now,
      none
    );
    for (const entry of pages) {
      const unknown = failed.some((month) => month.startsWith(entry.year));
      if (entry.shipping.empty !== null) continue;
      expect(entry.shipping.facts.length === 0).toBe(
        unknown || !dates.some((date) => date.startsWith(entry.year))
      );
      // Levels are quantiles of the year, so a busier day is never drawn quieter than a slower one.
      const seen: [number, number][] = [];
      for (const month of entry.shipping.months) {
        expect(month.cells === null).toBe(failed.includes(month.month));
        for (const cell of month.cells ?? []) {
          expect(cell.date <= today).toBe(true);
          const shippedThatDay = counts.get(cell.date);
          if (shippedThatDay === undefined) expect(cell.level).toBeNull();
          else {
            expect(cell.level === 0).toBe(shippedThatDay === 0);
            seen.push([shippedThatDay, cell.level ?? -1]);
          }
        }
      }
      seen.sort(([a, x], [b, y]) => a - b || x - y);
      for (const [index, [count, level]] of seen.entries()) {
        const [lastCount = 0, lastLevel = 0] = seen[index - 1] ?? [];
        expect(level).toBeGreaterThanOrEqual(lastLevel);
        if (count === lastCount && index > 0) expect(level).toBe(lastLevel);
      }
      if (entry.usage.empty === null) expect(entry.usage.total === null).toBe(unknown);
    }
  });
});

describe("the link-preview image's figures", () => {
  // Catches the card stating a total the page leaves out (a year with an unknown month) or
  // dropping the page's "on record" when dates are missing, and a plural on a count of one.
  it('come from the same sums as the page, and only where the page has totals', () => {
    const merged = { ...shipped('2025-03-03'), merges: 1 };
    const full = run('2025-01-01', '2025-12-31').map((date) =>
      date === merged.date ? merged : shipped(date)
    );
    const posts: Published[] = [
      { date: '2025-04-01', title: 'A', path: '/writing/a', kind: 'Post' },
      { date: '2025-05-01', title: 'B', path: '/til/b', kind: 'Note' },
    ];
    const whole = yearPages(
      history(
        full,
        run('2025-01-01', '2025-12-31').map((date) => used(date, 1000))
      ),
      posts,
      after,
      none
    );
    expect(page(whole, '2025')).toMatchObject({
      figures: [
        { value: '1', label: 'PR merged', partial: false },
        { value: '365', label: 'days shipped', partial: false },
        { value: '365.0K', label: 'agent tokens', partial: false },
      ],
      figureScope: '',
    });

    const holed = yearPages(
      history(full, [used('2025-02-01', 1000), used('2025-02-02', 2000)], {
        shipping: ['2025-06'],
      }),
      posts,
      after,
      none
    );
    expect(page(holed, '2025')).toMatchObject({
      figures: [
        { value: '3.0K', label: 'agent tokens', partial: true },
        { value: '2', label: 'posts and notes published', partial: false },
      ],
      figureScope: 'on record',
    });
  });
});
