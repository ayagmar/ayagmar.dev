/**
 * Reading signals from the browser for the blocks a build cannot keep current (ADR 0015):
 * agent hours on /stats, the desktop facts and this month's agents on /uses. Each block is
 * hidden in the page's HTML and shown only while the last good answer still holds at the
 * time it is checked.
 */
import { rabatDate } from '@min7/contracts/rabat';

/**
 * Whether the browser's tzdata knows Morocco's current rules, +00 for good since 2026-09-20
 * 01:00 UTC: with older rules it is still +01 there, and the date flips an hour early. The
 * room's `knowsRabatTime` (src/lib/sky.ts) checks the same; this copy keeps the /stats and
 * /uses scripts from sharing a chunk with the home page's.
 */
export const knowsRabatDate = () => rabatDate(Date.UTC(2026, 9, 1, 23, 30)) === '2026-10-01';

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
 * Asks `endpoint` while the page is visible, one request at a time with a 5 s deadline: on
 * load, then every `everyMs`. After each answer, every minute, and whenever the tab comes
 * back (visibility, focus, back/forward cache), `show(answer, now)` decides again what the
 * page shows, so a value disappears the moment it stops holding. A failed request keeps the
 * last good answer; `show` still drops it once it no longer holds.
 */
export function poll(
  endpoint: string,
  everyMs: number,
  show: (answer: unknown, now: number) => void
): void {
  let answer: unknown;
  let asked = 0;
  let pending = false;

  function check() {
    const now = Date.now();
    show(answer, now);
    if (pending || document.hidden || (asked !== 0 && now - asked < everyMs)) return;
    asked = now;
    pending = true;
    fetch(endpoint, { signal: AbortSignal.timeout(5_000) })
      // An error status is a failure, whatever its body says.
      .then((response) => (response.ok ? response.json() : undefined))
      .catch(() => undefined)
      .then((body) => {
        pending = false;
        if (body !== undefined) answer = body;
        show(answer, Date.now());
      });
  }

  check();
  setInterval(check, 60_000);
  document.addEventListener('visibilitychange', check);
  window.addEventListener('focus', check);
  window.addEventListener('pageshow', check);
}

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** `26 Oct, 08:00 UTC`: the same text in every browser. */
export function utcTime(time: number): string {
  const date = new Date(time);
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

/** A `<time>` for `iso` reading `text`. */
export function timeElement(iso: string, text: string): HTMLTimeElement {
  const time = document.createElement('time');
  time.dateTime = iso;
  time.textContent = text;
  return time;
}
