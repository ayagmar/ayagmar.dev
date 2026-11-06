/**
 * Numbers, names and dates in words, for every page, text copy and the room. Every script shares
 * this module, so what only one of them needs belongs in that script's own.
 */
import { rabatTimeZone } from '@min7/contracts/rabat';

export const dayMs = 86_400_000;

const units: [size: number, unit: string][] = [
  [1e12, 'T'],
  [1e9, 'B'],
  [1e6, 'M'],
  [1e3, 'K'],
];
const oneDecimal = { minimumFractionDigits: 1, maximumFractionDigits: 1 };

/** `41.0B`, `1.8B`, `61.3M`, `950.0K`, `999`: one decimal from a thousand up. */
export function tokens(count: number): string {
  const at = units.findIndex(([size]) => count >= size);
  if (at === -1) return count.toLocaleString('en');
  const shown = (index: number) => {
    const [size, unit] = units[index] as [number, string];
    return { value: Math.round((count / size) * 10) / 10, unit };
  };
  let { value, unit } = shown(at);
  // 999,960 is 1,000.0K at one decimal: the next unit up says it better.
  if (value >= 1000 && at > 0) ({ value, unit } = shown(at - 1));
  return `${value.toLocaleString('en', oneDecimal)}${unit}`;
}

/** `ayagmar/runnerd` -> `runnerd`. */
export const repoName = (repo: string) => repo.slice(repo.indexOf('/') + 1);

/** `2026-10-24` from an RFC 3339 timestamp, in UTC. */
export const utcDay = (iso: string) => new Date(iso).toISOString().slice(0, 10);

export const utcDate = (date: string) => Date.parse(`${date}T00:00:00Z`);
export const isoDate = (time: number) => new Date(time).toISOString().slice(0, 10);
const dayMonth = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
});

/** `26 Oct`, of a calendar date. */
export const dayWords = (date: string) => dayMonth.format(utcDate(date));

/** `1–26 Oct`, `28 Sept–4 Oct`, or `1 Oct` for a single day. */
export function dateRange(from: string, to: string): string {
  if (from === to) return dayWords(to);
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  return `${sameMonth ? String(Number(from.slice(8))) : dayWords(from)}–${dayWords(to)}`;
}

/**
 * `26 Oct, 09:00`, in Rabat: a time as pages show it without JavaScript, the same in every
 * browser and no longer than the relative times the page's script puts in its place
 * (src/lib/live.ts), so the swap moves nothing.
 */
export const rabatStamp = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: rabatTimeZone,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(Date.parse(iso));
