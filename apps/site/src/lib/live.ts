/**
 * Keeping signals current in the browser (ADR 0015). A page renders each source's snapshot at
 * build time, as the no-JS fallback and first paint; a panel marked with `data-live` is then
 * replaced by a newer valid answer from `/v1/<source>` and its times read relative to now.
 * Adding a source is a reader for its data and a renderer for its panel. This half is pure, for
 * the page scripts and the site Worker; src/lib/live-page.ts is the half that touches the page.
 * Nothing here loads zod or the contracts' schemas.
 */
import { dayMs } from '@min7/contracts/rabat';

const instant =
  /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

/**
 * `value` in ms since the epoch if it is an instant the contract accepts (`z.iso.datetime()`,
 * with an offset only if `offset`), else undefined. Date.parse alone moves a day the calendar
 * does not have, such as 30 February, into the next month; its date read back shows that.
 */
export function instantMs(value: unknown, offset = false): number | undefined {
  const match = typeof value === 'string' ? instant.exec(value) : null;
  if (!match || (!offset && match[2] !== 'Z')) return;
  const day = new Date(`${match[1]}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().startsWith(match[1] as string)
    ? Date.parse(match[0])
    : undefined;
}

/** How long a tab that comes back waits since its last request before asking again. */
const returnMs = 60_000;

/**
 * Whether to ask again `sinceMs` after the last request. On a timer, once `everyMs` has
 * passed; the minute timer may fire a little early, so one due within 5 s goes now. When the
 * tab comes back (visibility, focus, back/forward cache), once `returnMs` has, or `everyMs` if
 * shorter: a tab that slept shows what signals has now, not what it had when the tab hid.
 */
export const due = (sinceMs: number, everyMs: number, returned: boolean) =>
  sinceMs >= (returned ? Math.min(everyMs, returnMs) : everyMs - 5_000);

/**
 * The JSON body `endpoint` answers with, or undefined if the request fails: an error status,
 * whatever its body says, no answer within 5 s (the deadline covers the body), or a body that
 * is not JSON. Every script that asks signals asks through this.
 */
export const ask = (endpoint: string): Promise<unknown> =>
  fetch(endpoint, { signal: AbortSignal.timeout(5_000) })
    .then((response) => (response.ok ? response.json() : undefined))
    .catch(() => undefined);

// Formatters are made once: making one per call, as toLocaleString does, cost /stats most of
// its script time on load (mobile TBT, ADR 0017).
const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const dayMonthYear = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
/** Days since the epoch of `time`'s calendar date in the reader's own time zone. */
export const day = (time: number) => {
  const date = new Date(time);
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / dayMs;
};

/**
 * How long before `now` the instant `time` was, as a person says it in the reader's time
 * zone: `just now`, `3 minutes ago`, `5 hours ago`, `yesterday`, `3 days ago`, then the date.
 * Within 6 hours it counts hours even across midnight; after that a different calendar date
 * is `yesterday` however few hours ago it was.
 */
export function ago(time: number, now: number): string {
  const minutes = Math.floor((now - time) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return relative.format(-minutes, 'minute');
  const days = day(now) - day(time);
  if (days < 1 || minutes < 360) return relative.format(-Math.floor(minutes / 60), 'hour');
  if (days < 7) return relative.format(-days, 'day');
  return (
    new Date(time).getFullYear() === new Date(now).getFullYear() ? dayMonth : dayMonthYear
  ).format(time);
}

/** The words before a source's update time, which ends the line: `Updated 3 minutes ago`. */
export const freshnessWords = (fresh: boolean) =>
  fresh ? 'Updated ' : 'May be out of date: updated ';

// Checks the readers share, each as the contract states it (packages/contracts/src/snapshots).
/** A non-empty string, at most `max` characters. */
export const text = (value: unknown, max = Infinity): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;
/** A whole number from `min` up. */
export const whole = (value: unknown, min = 0): value is number =>
  Number.isSafeInteger(value) && (value as number) >= min;
/** A calendar date, `2026-10-24`. */
export const calendarDate = (value: unknown) =>
  typeof value === 'string' && value.length === 10 && instantMs(`${value}T00:00:00Z`) !== undefined;
/** An array of at most `max` items, each passing `check`. */
export const list = (value: unknown, max: number, check: (item: unknown) => boolean) =>
  Array.isArray(value) && value.length <= max && value.every(check);

/** A checked `/v1/<source>` answer. */
export interface Answer<Data> {
  data: Data;
  fetchedAt: string;
  at: number;
  stale: boolean;
}

/** A server clock up to this far ahead of the reader's is still believable. */
export const skewMs = 2 * 60_000;

/**
 * The answer in `body` if it is a `/v1/<source>` envelope the page may show at `now`: this
 * source, version 1, a `stale` flag, a `fetchedAt` the contract accepts and not from the
 * future, and data that `read` accepts. A source that never succeeded (`data: null`) has
 * nothing to show.
 */
export function readAnswer<Data>(
  body: unknown,
  source: string,
  read: (data: unknown) => Data | undefined,
  now: number
): Answer<Data> | undefined {
  const { source: from, version, stale, fetchedAt, data } = Object(body);
  const at = instantMs(fetchedAt, true);
  if (from !== source || version !== 1 || typeof stale !== 'boolean') return;
  if (at === undefined || at > now + skewMs || data === null) return;
  const checked = read(data);
  return checked === undefined ? undefined : { data: checked, fetchedAt, at, stale };
}

/**
 * Whether `answer` still describes `time`: not flagged stale by signals, within the source's
 * threshold of `limit` ms, and at least as new as what is shown, taken at `shownAt` (NaN if
 * nothing is).
 */
export const isCurrent = <Data>(
  answer: Answer<Data> | undefined,
  limit: number,
  time: number,
  shownAt: number
): answer is Answer<Data> =>
  answer !== undefined && !answer.stale && time - answer.at <= limit && !(answer.at < shownAt);

/** What a source's reader knows after a refresh. */
export interface Followed<Data> {
  /** The accepted answer: the build's, with no data, until a request brings a better one. */
  shown: Omit<Answer<Data>, 'data'> & { data?: Data };
  /** `shown` is within the source's threshold of now. */
  fresh: boolean;
  /** The latest request brought `shown`, and it is fresh: it still describes now. */
  now: boolean;
}

/**
 * The one rule for which answer a source shows, without the page: a function to call after each
 * refresh with what `poll` hands over. Only a current answer replaces what is shown: valid, not
 * flagged stale by signals, within the threshold of `limit` ms, and at least as new. Anything
 * else keeps it, and then the answer no longer describes now. `builtAt` is when the build's
 * snapshot was taken, absent when it had none.
 */
export function follow<Data>(
  source: string,
  limit: number,
  read: (data: unknown) => Data | undefined,
  builtAt: string | undefined
) {
  let shown: Followed<Data>['shown'] = {
    fetchedAt: builtAt ?? '',
    at: instantMs(builtAt, true) ?? Number.NaN,
    stale: false,
  };
  return (body: unknown, time: number, failed: boolean): Followed<Data> => {
    const answer = readAnswer(body, source, read, time);
    const current = isCurrent(answer, limit, time, shown.at);
    if (current) shown = answer;
    const fresh = time - shown.at <= limit;
    return { shown, fresh, now: fresh && !failed && current };
  };
}
