/**
 * Year pages (ADR 0041): what the daily history and the published writing say about one calendar
 * year, counted and worded once here. The page only renders it. Each series keeps its own
 * calendar, as on the day pages: shipping days are UTC dates, agent usage days dates in Rabat, so
 * they never share a count and each has its own "today". A month that failed to load is unknown:
 * its series' totals and facts are left out, never counted as if the month were quiet.
 */
import type { LlmUsageDay, ShippingActivityDay } from '@min7/contracts';
import { rabatDate } from '@min7/contracts/rabat';
import {
  repoName,
  type ShippingStrip,
  type StripCell,
  shippedCount,
  shippedWords,
  stripCell,
  stripOf,
} from '../data/format.ts';
import {
  type Counts,
  dayPath,
  type Published,
  plural,
  range,
  repoHref,
  shipped,
  short,
  unnamedRepos,
  unread,
} from './days.ts';
import { hours, tokens } from './llm-usage-panel.ts';

/** A series as the build read it (`readHistory`). */
interface Series<Day> {
  days: readonly Day[];
  /** Months, `YYYY-MM`, that failed to load. */
  failed: readonly string[];
  fetchedAt: string | null;
}

export interface YearHistory {
  shipping: Series<ShippingActivityDay>;
  usage: Series<LlmUsageDay>;
}

/** A line of facts: a label, then text, each piece a link when it has a `path`. */
export interface Fact {
  label: string;
  value: { text: string; path: string | null }[];
}

/** A month of the calendar; `cells` is null when the month failed to load. */
interface CalendarMonth {
  month: string;
  /** `October`. */
  name: string;
  /** The column of its first day, 1 for a Monday to 7 for a Sunday. */
  column: number;
  cells: StripCell[] | null;
}

/** The shipping half of a year: a line when there is nothing to draw, else the calendar. */
type ShippingYear =
  | { empty: string }
  | {
      empty: null;
      months: CalendarMonth[];
      strip: ShippingStrip;
      facts: Fact[];
      /** Said when facts are left out, or when they count repositories they do not name. */
      notes: string[];
    };

/** One month of agent usage; `state` says why a row has no numbers. */
type UsageRow =
  | { name: string; state: 'unknown' | 'none' }
  | { name: string; state: 'recorded'; tokens: string; time: string | null; days: string };

/** The agent usage half: a line when there is nothing to list, else the months. */
type UsageYear =
  | { empty: string }
  | {
      empty: null;
      rows: UsageRow[];
      /** The year's row; null when a month is unknown. */
      total: (UsageRow & { state: 'recorded' }) | null;
      facts: Fact[];
      notes: string[];
    };

interface YearLink {
  path: string;
  title: string;
}

export interface YearPage {
  /** `2026`. */
  year: string;
  path: string;
  description: string;
  /** Whether the year has anything to read; a page that only says it could not be read is not. */
  hasContent: boolean;
  /** Whether the year is still running in either series' calendar. */
  current: boolean;
  shipping: ShippingYear;
  usage: UsageYear;
  published: Published[];
  /** The neighbouring years that have a page. */
  previous: YearLink | null;
  next: YearLink | null;
}

export const yearPath = (year: string) => `/${year}`;

const monthName = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long' });
const dayMs = 86_400_000;
const at = (date: string) => Date.parse(`${date}T00:00:00Z`);
const isoDate = (time: number) => new Date(time).toISOString().slice(0, 10);
const nameOf = (month: string) => monthName.format(at(`${month}-01`));
const inYear = (year: string) => (entry: { date: string }) => entry.date.startsWith(`${year}-`);

/** The months of `year` that have begun on `today`. */
function monthsOf(year: string, today: string): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`).filter(
    (month) => month <= today.slice(0, 7)
  );
}

/** The dates of `month` up to `today`, 28 to 31 of them. */
function datesOf(month: string, today: string): string[] {
  const [year = 0, index = 0] = month.split('-').map(Number);
  const length = new Date(Date.UTC(year, index, 0)).getUTCDate();
  return Array.from({ length }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`).filter(
    (date) => date <= today
  );
}

const list = (names: string[]) =>
  names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

/** Why a series' totals are missing: `October and March could not be read…`. */
const unknownNote = (months: readonly string[]) =>
  `${list(months.map(nameOf))} could not be read when this page was built, so the totals are left out.`;

const text = (value: string) => ({ text: value, path: null });

/** The largest by `size`, the earliest of equals; null when all are 0. */
function largest<Item>(items: readonly Item[], size: (item: Item) => number): Item | null {
  let best: Item | null = null;
  for (const item of items) {
    if (size(item) > (best === null ? 0 : size(best))) best = item;
  }
  return best;
}

/**
 * The longest run of consecutive dates in `year` with something shipped, the earliest of equals.
 * A day without a record ends a run, and the run is counted inside the year: a run that crosses
 * 31 December is told apart in words, its length here being this year's days.
 */
function longestRun(active: ReadonlySet<string>, year: string): string | null {
  const dates = [...active].filter((date) => date.startsWith(`${year}-`)).sort();
  let best: { from: string; to: string; length: number } | null = null;
  let start = 0;
  for (let i = 0; i < dates.length; i += 1) {
    const next = dates[i + 1];
    const date = dates[i] as string;
    if (next !== undefined && at(next) - at(date) === dayMs) continue;
    if (best === null || i - start + 1 > best.length) {
      best = { from: dates[start] as string, to: date, length: i - start + 1 };
    }
    start = i + 1;
  }
  if (best === null) return null;
  const before = best.from === `${year}-01-01` && active.has(isoDate(at(best.from) - dayMs));
  const after = best.to === `${year}-12-31` && active.has(isoDate(at(best.to) + dayMs));
  return [
    `${plural(best.length, 'day', 'days')}, ${range(best.from, best.to)}`,
    before && `on from ${Number(year) - 1}`,
    after && `on into ${Number(year) + 1}`,
  ]
    .filter(Boolean)
    .join(', ');
}

/** What the shipping half lists, from a year with no unknown month and a recorded day. */
function shippingFacts(
  days: readonly ShippingActivityDay[],
  all: readonly ShippingActivityDay[],
  year: string,
  soFar: string,
  pages: ReadonlySet<string>
): Fact[] {
  const zero: Counts = { pushes: 0, commits: 0, merges: 0, releases: 0, stars: 0 };
  const total = days.reduce(
    (sum, day): Counts => ({
      pushes: sum.pushes + day.pushes,
      commits: sum.commits + day.commits,
      merges: sum.merges + day.merges,
      releases: sum.releases + day.releases,
      stars: sum.stars + day.stars,
    }),
    zero
  );
  const busiest = largest(days, shippedCount);
  if (busiest === null) return [{ label: `Shipped${soFar}`, value: [text('Nothing shipped.')] }];

  const months = new Map<string, number>();
  const repos = new Map<string, number>();
  for (const day of days) {
    const month = day.date.slice(0, 7);
    months.set(month, (months.get(month) ?? 0) + shippedCount(day));
    for (const entry of day.repos) {
      repos.set(entry.repo, (repos.get(entry.repo) ?? 0) + shippedCount(entry));
    }
  }
  const active = days.filter((day) => shippedCount(day) > 0).length;
  const [month, monthCount] = largest([...months], ([, value]) => value) ?? ['', 0];
  const run = longestRun(
    new Set(all.filter((day) => shippedCount(day) > 0).map((day) => day.date)),
    year
  );
  const top = [...repos]
    .filter(([, value]) => value > 0)
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .slice(0, 3);
  return [
    {
      label: `Shipped${soFar}`,
      value: [text(`${shipped(total)} on ${plural(active, 'day', 'days')}`)],
    },
    {
      label: `Busiest day${soFar}`,
      value: [
        {
          text: short(busiest.date),
          path: pages.has(busiest.date) ? dayPath(busiest.date) : null,
        },
        text(`: ${shippedWords(shippedCount(busiest))}`),
      ],
    },
    ...(run === null ? [] : [{ label: `Longest run${soFar}`, value: [text(run)] }]),
    {
      label: `Busiest month${soFar}`,
      value: [text(`${nameOf(month)}: ${shippedWords(monthCount)}`)],
    },
    ...(top.length === 0
      ? []
      : [
          {
            label: `Top repositories${soFar}`,
            value: top.flatMap(([repo, value], index) => [
              ...(index > 0 ? [text(', ')] : []),
              { text: repoName(repo), path: repoHref(repo) },
              text(` (${value.toLocaleString('en')})`),
            ]),
          },
        ]),
  ];
}

function shippingYear(
  history: Series<ShippingActivityDay>,
  year: string,
  today: string,
  pages: ReadonlySet<string>
): ShippingYear {
  const days = history.days.filter(inYear(year));
  const failed = history.failed.filter((month) => month.startsWith(`${year}-`));
  const byDate = new Map(days.map((day) => [day.date, shippedCount(day)]));
  const months = monthsOf(year, today).map((month): CalendarMonth => {
    const first = (new Date(at(`${month}-01`)).getUTCDay() + 6) % 7;
    return {
      month,
      name: nameOf(month),
      column: first + 1,
      cells: failed.includes(month)
        ? null
        : datesOf(month, today).map((date) => stripCell(date, byDate.get(date) ?? null, pages)),
    };
  });
  const strip = stripOf(
    months.flatMap((month) => month.cells ?? []),
    history.fetchedAt ?? ''
  );
  if (strip === null || history.fetchedAt === null) {
    return {
      empty: failed.length > 0 ? unread('Shipping') : `No shipping recorded in ${year}.`,
    };
  }
  const soFar = today.startsWith(`${year}-`) ? ' so far' : '';
  return {
    empty: null,
    months,
    strip,
    facts: failed.length > 0 ? [] : shippingFacts(days, history.days, year, soFar, pages),
    notes: [
      ...(failed.length > 0 ? [unknownNote(failed)] : []),
      ...(failed.length === 0 && days.some((day) => !day.reposComplete) ? [unnamedRepos] : []),
    ],
  };
}

/** The numbers of one month of usage, or of the year. */
function usageRow(name: string, days: readonly LlmUsageDay[]) {
  const timed = days.filter((day) => day.activeMs !== undefined);
  const ms = timed.reduce((sum, day) => sum + (day.activeMs ?? 0), 0);
  const used = days.filter((day) => day.totalTokens > 0 || (day.activeMs ?? 0) > 0);
  // Absent is unknown, not none (ADR 0014): a sum missing some days is a lower bound.
  const time =
    timed.length === 0 ? null : `${timed.length < days.length ? 'at least ' : ''}${hours(ms)}`;
  return {
    name,
    state: 'recorded' as const,
    tokens: tokens(days.reduce((sum, day) => sum + day.totalTokens, 0)),
    time,
    days: used.length.toLocaleString('en'),
  };
}

function usageYear(
  history: Series<LlmUsageDay>,
  year: string,
  today: string,
  pages: ReadonlySet<string>
): UsageYear {
  const days = history.days.filter(inYear(year));
  const failed = history.failed.filter((month) => month.startsWith(`${year}-`));
  if (days.length === 0) {
    return {
      empty: failed.length > 0 ? unread('Agent usage') : `No agent usage recorded in ${year}.`,
    };
  }
  const rows = monthsOf(year, today).map((month): UsageRow => {
    const name = nameOf(month);
    if (failed.includes(month)) return { name, state: 'unknown' };
    const recorded = days.filter((day) => day.date.startsWith(`${month}-`));
    return recorded.length === 0 ? { name, state: 'none' } : usageRow(name, recorded);
  });
  const soFar = today.startsWith(`${year}-`) ? ' so far' : '';
  const busiest = failed.length > 0 ? null : largest(days, (day) => day.totalTokens);
  return {
    empty: null,
    rows,
    total: failed.length > 0 ? null : usageRow(soFar === '' ? 'The year' : 'So far', days),
    facts:
      busiest === null
        ? []
        : [
            {
              label: `Busiest day${soFar}`,
              value: [
                {
                  text: short(busiest.date),
                  path: pages.has(busiest.date) ? dayPath(busiest.date) : null,
                },
                text(`: ${tokens(busiest.totalTokens)} tokens`),
              ],
            },
          ],
    notes: failed.length > 0 ? [unknownNote(failed)] : [],
  };
}

/**
 * One page per calendar year with a recorded day in either series, something published, or a
 * month that failed to load: an unknown month may hold records, and a page already in search must
 * not vanish because a read failed. Oldest first, each linked to its neighbours. `now` is the
 * build's time; `pages` the dates that have a day page. The newest published first in each year.
 */
export function yearPages(
  history: YearHistory,
  published: readonly Published[],
  now: Date,
  pages: ReadonlySet<string>
): YearPage[] {
  const shippingToday = now.toISOString().slice(0, 10);
  const usageToday = rabatDate(now.getTime());
  const years = [
    ...new Set(
      [
        ...history.shipping.days.map((day) => day.date),
        ...history.usage.days.map((day) => day.date),
        ...published.map((entry) => entry.date),
        ...history.shipping.failed,
        ...history.usage.failed,
      ].map((date) => date.slice(0, 4))
    ),
  ].sort();
  const link = (year: string | undefined) =>
    year === undefined ? null : { path: yearPath(year), title: year };
  return years.map((year, index) => {
    const current = [shippingToday, usageToday].some((today) => today.startsWith(`${year}-`));
    const entries = published
      .filter(inYear(year))
      .toSorted((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
    const shipping = shippingYear(history.shipping, year, shippingToday, pages);
    const usage = usageYear(history.usage, year, usageToday, pages);
    return {
      year,
      path: yearPath(year),
      description: `What shipped, how much the coding agents ran, and what was published in ${year}${current ? ' so far' : ''}.`,
      hasContent: entries.length > 0 || shipping.empty === null || usage.empty === null,
      current,
      shipping,
      usage,
      published: entries,
      previous: link(years[index - 1]),
      next: link(years[index + 1]),
    };
  });
}
