import type {
  Envelope,
  Project,
  ShippingActivityDay,
  ShippingActivityDays,
  ShippingEvent,
  ShippingSnapshot,
} from '@min7/contracts';
import { rabatTimeZone } from '@min7/contracts/rabat';

const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString('en')} ${count === 1 ? one : many}`;

/** `ayagmar/runnerd` -> `runnerd`. */
export const repoName = (repo: string) => repo.slice(repo.indexOf('/') + 1);

/** What happened, in a few words, for a shipping event. */
export function describeEvent(event: ShippingEvent): string {
  switch (event.type) {
    case 'release':
      return `released ${event.tag}`;
    case 'push':
      return `pushed ${plural(event.commits, 'commit', 'commits')}`;
    case 'merge':
      return `merged #${event.number}: ${event.title}`;
    case 'stars':
      return `gained ${plural(event.gained, 'star', 'stars')} (${event.total.toLocaleString('en')} total)`;
  }
}

/** `2026-10-24` from an RFC 3339 timestamp, in UTC. */
export const utcDay = (iso: string) => new Date(iso).toISOString().slice(0, 10);

/**
 * `26 Oct, 09:00`, in Rabat: a time as pages show it without JavaScript, the same in every
 * browser and no longer than the relative times the page's script puts in its place
 * (src/lib/live.ts), so the swap moves nothing.
 */
export const rabatTime = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: rabatTimeZone,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(Date.parse(iso));

export const count = (value: number) => value.toLocaleString('en');

/** The /stats line about projects. Unknown star counts are never added as zero. */
export function projectsSummary(projects: readonly Pick<Project, 'stars'>[]): string {
  const known = projects.flatMap((project) => (project.stars === null ? [] : [project.stars]));
  const total = count(known.reduce((sum, stars) => sum + stars, 0));
  const missing = projects.length - known.length;
  const head = plural(projects.length, 'featured project', 'featured projects');
  return missing === 0
    ? `${head}, ${total} stars in total.`
    : `${head}, at least ${total} stars; GitHub did not answer for ${missing}.`;
}

const dayMs = 24 * 60 * 60 * 1000;

/** One day of the shipping strip or a year's calendar: its UTC date and level 0 to 4, or null for no record. */
export interface StripCell {
  date: string;
  level: 0 | 1 | 2 | 3 | 4 | null;
  /** What the square says to a screen reader: `26 Oct: 3 pushes, merges and releases`. */
  label: string;
  /** Whether the date has a day page (src/lib/days.ts), which the square then links to. */
  page: boolean;
}

/** What the shipping strip draws and says, computed once for every page that shows it. */
export interface ShippingStrip {
  cells: StripCell[];
  /** The first and last day with a record, as `3 Oct`. */
  from: string;
  to: string;
  /** Whether some days in the strip have no record: they are drawn outlined. */
  gaps: boolean;
  /** Days with something shipped. */
  busy: number;
  /** When the counts were taken, as `26 Oct, 08:55 UTC`. */
  countedAt: string;
}

const dayLabel = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
});
const timeLabel = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const level = (shipped: number): 0 | 1 | 2 | 3 | 4 =>
  shipped === 0 ? 0 : shipped === 1 ? 1 : shipped === 2 ? 2 : shipped < 5 ? 3 : 4;

/** What a square counts: pushes, merges and releases. Stars are attention, not shipping. */
export const shippedCount = (day: Pick<ShippingActivityDay, 'pushes' | 'merges' | 'releases'>) =>
  day.pushes + day.merges + day.releases;

/** `3 pushes, merges and releases`, what a count of `shippedCount` says. */
export const shippedWords = (count: number) =>
  plural(count, 'push, merge or release', 'pushes, merges and releases');

/** One UTC day's square; `shipped` is null when nothing was recorded for it. */
export function stripCell(
  date: string,
  shipped: number | null,
  pages: ReadonlySet<string>
): StripCell {
  const what =
    shipped === null ? 'no record' : shipped === 0 ? 'nothing shipped' : shippedWords(shipped);
  return {
    date,
    level: shipped === null ? null : level(shipped),
    label: `${dayLabel.format(Date.parse(date))}: ${what}`,
    page: pages.has(date),
  };
}

/** What a run of squares says. Null when none of them has a record. */
export function stripOf(cells: StripCell[], countedAt: string): ShippingStrip | null {
  const recorded = cells.filter((cell) => cell.level !== null);
  const first = recorded[0];
  const latest = recorded.at(-1);
  if (first === undefined || latest === undefined) return null;
  return {
    cells,
    from: dayLabel.format(Date.parse(first.date)),
    to: dayLabel.format(Date.parse(latest.date)),
    gaps: recorded.length < cells.length,
    busy: recorded.filter((cell) => (cell.level ?? 0) > 0).length,
    countedAt: `${timeLabel.format(Date.parse(countedAt))} UTC`,
  };
}

/** The words around a run of squares: its list's name and its caption's two lines. */
export function stripWords(strip: ShippingStrip) {
  const range = strip.from === strip.to ? strip.from : `${strip.from} to ${strip.to}`;
  const gaps = strip.gaps ? ' Outlined days have no record.' : '';
  return {
    label: `Shipping activity from ${range}: ${strip.busy} ${strip.busy === 1 ? 'day' : 'days'} with something shipped.${gaps} Counted up to ${strip.countedAt}, drawn when this page was built.`,
    squares: `One square a day, ${range}${strip.gaps ? '; outlined days have no record' : ''}`,
    counted: `Counted up to ${strip.countedAt}`,
  };
}

/**
 * The strip's 28 UTC days ending on `end`, each with what shipped that day, or null when nothing
 * was recorded for it. Null when no day of the strip has a record.
 */
function strip(
  end: string,
  shipped: (date: string) => number | null,
  countedAt: string,
  pages: ReadonlySet<string>
): ShippingStrip | null {
  const last = Date.parse(`${end}T00:00:00Z`);
  const cells = Array.from({ length: 28 }, (_, i) => {
    const date = new Date(last - (27 - i) * dayMs).toISOString().slice(0, 10);
    return stripCell(date, shipped(date), pages);
  });
  return stripOf(cells, countedAt);
}

/**
 * The shipping strip (ADR 0038), drawn once with the page. From the daily history when it has
 * a recorded day in the last 28: those days are drawn, the others outlined, and the counts are
 * as of the history's `fetchedAt`. Otherwise from the events in the shipping snapshot, which
 * cover only the days from the oldest event's to the snapshot's own, ending on `now`'s day.
 * Null when neither has a day to draw. A square links to its date's page when `pages` has it.
 */
export function shippingStrip(
  history: Envelope<ShippingActivityDays>,
  shipping: Envelope<Pick<ShippingSnapshot, 'events'>>,
  now: Date,
  pages: ReadonlySet<string>
): ShippingStrip | null {
  if (history.data !== null && history.fetchedAt !== null) {
    const days = new Map(history.data.days.map((day) => [day.date, shippedCount(day)]));
    const fromHistory = strip(
      history.data.to,
      (date) => days.get(date) ?? null,
      history.fetchedAt,
      pages
    );
    if (fromHistory !== null) return fromHistory;
  }
  const events = shipping.data?.events ?? [];
  if (shipping.fetchedAt === null || events.length === 0) return null;
  const oldest = Math.min(...events.map(({ at }) => Date.parse(at)));
  const firstDay = utcDay(new Date(oldest).toISOString());
  const lastDay = utcDay(shipping.fetchedAt);
  const counts = new Map<string, number>();
  for (const { type, at } of events) {
    if (type === 'stars') continue;
    counts.set(utcDay(at), (counts.get(utcDay(at)) ?? 0) + 1);
  }
  return strip(
    utcDay(now.toISOString()),
    (date) => (date < firstDay || date > lastDay ? null : (counts.get(date) ?? 0)),
    shipping.fetchedAt,
    pages
  );
}
