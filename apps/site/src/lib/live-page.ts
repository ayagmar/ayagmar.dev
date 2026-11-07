/**
 * The half of src/lib/live.ts that touches the page: polling while it is visible, the times that
 * read relative to now, and the panels marked `data-live`. Browser only; the site Worker imports
 * the pure half.
 */
import { type Answer, ago, ask, due, follow, freshnessWords } from './live.ts';

const exact = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Asks `endpoint` (`ask`) while the page is visible, one request at a time: on load, then every `everyMs`, and when the tab comes back once its last
 * request is a minute old (`due`). After each answer, every minute, and whenever the tab comes
 * back, `show(answer, now, failed)` decides again what the page shows. A failed request (an
 * error status, no answer in time, not JSON) keeps the last answer and sets `failed` until one
 * succeeds. Without an endpoint (fixtures mode) it never asks, and `show` still runs.
 */
export function poll(
  endpoint: string | undefined,
  everyMs: number,
  show: (answer: unknown, now: number, failed: boolean) => void
): void {
  let answer: unknown;
  let asked: number | undefined;
  let pending = false;
  let failed = false;

  /** `returned` when the tab has just come back, rather than on load or the minute timer. */
  function check(returned: boolean) {
    const now = Date.now();
    show(answer, now, failed);
    if (!endpoint || pending || document.hidden) return;
    if (asked !== undefined && !due(now - asked, everyMs, returned)) return;
    asked = now;
    pending = true;
    ask(endpoint).then((body) => {
      pending = false;
      failed = body === undefined;
      if (!failed) answer = body;
      show(answer, Date.now(), failed);
    });
  }

  const back = () => check(true);
  check(false);
  setInterval(() => check(false), 60_000);
  document.addEventListener('visibilitychange', back);
  window.addEventListener('focus', back);
  // Only a page restored from the back/forward cache: the first load's pageshow follows the
  // check above, and redrawing every panel again then cost mobile TBT (ADR 0017).
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) back();
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
    time.title = exact.format(at);
  }
}

let ticking = false;
/**
 * `tick` once the current task's other work is done: the panels of a page all check on load and
 * on every timer, and each would rewrite every time on the page (mobile TBT, ADR 0017).
 */
function tickSoon(): void {
  if (ticking) return;
  ticking = true;
  queueMicrotask(() => {
    ticking = false;
    tick(Date.now());
  });
}

/**
 * Keeps the panel `[data-live=<source>]` current. Its HTML is the build's snapshot, taken at
 * `data-fetched-at` (absent when the build had none), and `data-stale-after` gives the
 * source's threshold in seconds. In api mode `data-live-src` names the endpoint, asked every
 * `everyMs` while the page is visible. Which answer shows is `follow`'s rule, and a new one
 * goes through `render`. Whatever is shown is labelled with its age, and called out of date
 * once older than the threshold. `render` is told whether the answer still describes now.
 * `relabel`, if given, runs with `tick` every time, whatever is shown: for times the panel reads
 * relative to now its own way.
 */
export function live<Data>(
  source: string,
  everyMs: number,
  read: (data: unknown) => Data | undefined,
  render: (panel: HTMLElement, answer: Answer<Data>, now: boolean) => void,
  relabel?: (now: number) => void
): void {
  const panel = document.querySelector<HTMLElement>(`[data-live="${source}"]`);
  if (!panel) return;
  const { liveSrc, fetchedAt, staleAfter } = panel.dataset;
  const freshness = panel.querySelector<HTMLElement>('.freshness');
  const refreshed = follow(source, Number(staleAfter) * 1000, read, fetchedAt);
  let drawn = '';
  poll(liveSrc, everyMs, (body, time, failed) => {
    const { shown, fresh, now } = refreshed(body, time, failed);
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
    tickSoon();
    relabel?.(time);
  });
}
