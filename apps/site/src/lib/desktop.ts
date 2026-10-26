/**
 * The desktop facts on /uses (ADR 0032): which `/v1/desktop` answers the page may show, and
 * the uptime it derives from the last reported boot. Pure functions; the /uses script and the
 * tests share them. The value allowlists are the contract's own, from a module without zod.
 */
import { kernelReleasePattern, niriVersionPattern } from '@min7/contracts/desktop';
import { instantMs } from './live.ts';

/** `staleAfterSeconds.desktop` in contracts (which loads zod); a test keeps them equal. */
export const desktopStaleAfterMs = 2 * 24 * 60 * 60 * 1000;

export interface DesktopFacts {
  fetchedAt: string;
  kernel: string | null;
  niri: string | null;
  bootedAt: string;
}

/**
 * The facts in a `/v1/desktop` answer if the page may show them at `now`, else undefined: a
 * fresh envelope of this source, reported less than 2 days before `now` and not after it,
 * with each value in its allowlist and a boot time (UTC) no later than the report. Both times
 * must be days the calendar has. Freshness is
 * worked out here from `fetchedAt`, whatever `stale` said when the answer was served.
 */
export function readDesktop(body: unknown, now: number): DesktopFacts | undefined {
  const { source, version, stale, fetchedAt, data } = Object(body);
  if (source !== 'desktop' || version !== 1 || stale !== false) return;
  const taken = instantMs(fetchedAt, true);
  if (taken === undefined || taken > now || now - taken > desktopStaleAfterMs) return;
  const { kernel, niri, bootedAt } = Object(data);
  const booted = instantMs(bootedAt);
  if (booted === undefined || booted < 0 || booted > taken) return;
  const valid = (value: unknown, pattern: RegExp, max: number) =>
    value === null || (typeof value === 'string' && value.length <= max && pattern.test(value));
  if (!valid(kernel, kernelReleasePattern, 48) || !valid(niri, niriVersionPattern, 8)) return;
  return { fetchedAt, kernel, niri, bootedAt };
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** `3 days`, `5 hours`, `under an hour`: time since `bootedAt`, rounded down. */
export function uptime(bootedAt: string, now: number): string {
  const hours = Math.floor((now - Date.parse(bootedAt)) / 3_600_000);
  if (hours < 1) return 'under an hour';
  return hours < 24 ? plural(hours, 'hour') : plural(Math.floor(hours / 24), 'day');
}
