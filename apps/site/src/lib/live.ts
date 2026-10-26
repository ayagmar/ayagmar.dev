/**
 * Keeping signals current in the browser (ADR 0015). A page renders each source's snapshot at
 * build time, as the no-JS fallback and first paint; a panel marked with `data-live` is then
 * replaced by a newer valid answer from `/v1/<source>` and its times read relative to now.
 * Adding a source is a reader for its data and a renderer for its panel. Shared by the home
 * page's now-playing script and the /stats and /uses scripts; nothing here loads zod or the
 * contracts' schemas.
 */

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

/**
 * Asks `endpoint` while the page is visible, one request at a time with a 5 s deadline that
 * covers the body: on load, then every `everyMs`. After each answer, every minute, and
 * whenever the tab comes back (visibility, focus, back/forward cache), `show(answer, now,
 * failed)` decides again what the page shows. A failed request (an error status, no answer in
 * time, not JSON) keeps the last answer and sets `failed` until one succeeds. Without an
 * endpoint (fixtures mode) it never asks, and `show` still runs.
 */
export function poll(
  endpoint: string | undefined,
  everyMs: number,
  show: (answer: unknown, now: number, failed: boolean) => void
): void {
  let answer: unknown;
  let asked = 0;
  let pending = false;
  let failed = false;

  function check() {
    const now = Date.now();
    show(answer, now, failed);
    // The minute timer may fire a little early; a request due within 5 s goes now.
    if (!endpoint || pending || document.hidden || now - asked < everyMs - 5_000) return;
    asked = now;
    pending = true;
    fetch(endpoint, { signal: AbortSignal.timeout(5_000) })
      // An error status is a failure, whatever its body says.
      .then((response) => (response.ok ? response.json() : undefined))
      .catch(() => undefined)
      .then((body) => {
        pending = false;
        failed = body === undefined;
        if (!failed) answer = body;
        show(answer, Date.now(), failed);
      });
  }

  check();
  setInterval(check, 60_000);
  document.addEventListener('visibilitychange', check);
  window.addEventListener('focus', check);
  window.addEventListener('pageshow', check);
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
/** Days since the epoch of `time`'s calendar date in the reader's own time zone. */
const day = (time: number) => {
  const date = new Date(time);
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
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
  const date = new Date(time);
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric',
  });
}

/**
 * A `<time>` for `iso` that `tick` keeps reading relative to now. Its text is filled in by
 * `tick`; the title gives the exact time in the reader's locale and time zone. It sits in a
 * box as wide as the longest relative time (base.css), so its text can change without
 * moving anything; text after it on the same line would leave a gap, so it ends or starts
 * its line.
 */
export function stamp(iso: string): HTMLTimeElement {
  const time = document.createElement('time');
  time.dateTime = iso;
  time.dataset.ago = '';
  return time;
}

/** Rewrites every `time[data-ago]` on the page relative to `now`, the build's ones included. */
export function tick(now: number): void {
  for (const time of document.querySelectorAll<HTMLTimeElement>('time[data-ago]')) {
    const at = Date.parse(time.dateTime);
    time.textContent = ago(at, now);
    time.title = new Date(at).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }
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

// A server clock up to this far ahead of the reader's is still believable.
const skewMs = 2 * 60_000;

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
 * Keeps the panel `[data-live=<source>]` current. Its HTML is the build's snapshot, taken at
 * `data-fetched-at` (absent when the build had none), and `data-stale-after` gives the
 * source's threshold in seconds. In api mode `data-live-src` names the endpoint, asked every
 * `everyMs` while the page is visible. A valid answer at least as new as what is shown
 * replaces it through `render`; anything else keeps it. Whatever is shown is labelled with its
 * age, and called out of date once older than the threshold or when signals said so. `render`
 * is told whether the answer still describes now: fresh, and the latest request brought it or
 * an older one, not a failure or an answer the page cannot use.
 */
export function live<Data>(
  source: string,
  everyMs: number,
  read: (data: unknown) => Data | undefined,
  render: (panel: HTMLElement, answer: Answer<Data>, now: boolean) => void
): void {
  const panel = document.querySelector<HTMLElement>(`[data-live="${source}"]`);
  if (!panel) return;
  const { liveSrc, fetchedAt, staleAfter } = panel.dataset;
  const freshness = panel.querySelector<HTMLElement>('.freshness');
  // The build's snapshot until an answer replaces it.
  let shown: Omit<Answer<Data>, 'data'> & { data?: Data } = {
    fetchedAt: fetchedAt ?? '',
    at: instantMs(fetchedAt, true) ?? Number.NaN,
    stale: false,
  };
  let drawn = '';
  poll(liveSrc, everyMs, (body, time, failed) => {
    const answer = readAnswer(body, source, read, time);
    if (answer && !(answer.at < shown.at)) shown = answer;
    const fresh = !shown.stale && time - shown.at <= Number(staleAfter) * 1000;
    const now = fresh && !failed && answer !== undefined;
    const key = `${shown.at} ${fresh} ${now}`;
    if (key !== drawn && shown.fetchedAt) {
      drawn = key;
      if (shown.data !== undefined) render(panel, shown as Answer<Data>, now);
      // In fixtures mode the line says the data is a sample, and stays.
      if (liveSrc && freshness) {
        freshness.replaceChildren(freshnessWords(fresh), stamp(shown.fetchedAt));
        freshness.hidden = false;
      }
    }
    tick(time);
  });
}
