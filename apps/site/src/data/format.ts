import type { Project, ShippingEvent } from '@min7/contracts';
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

/**
 * The shipping heat strip: how busy each of the last `days` UTC days was, oldest first and
 * ending with the day of `now`, as a level from 0 (nothing) to 4. An event counts for the
 * day it happened; those older than the strip or after `now` count for none.
 */
export function heatLevels(events: readonly Pick<ShippingEvent, 'at'>[], now: Date, days = 28) {
  const today = Math.floor(now.getTime() / dayMs);
  const counts = new Array<number>(days).fill(0);
  for (const { at } of events) {
    const index = days - 1 - (today - Math.floor(Date.parse(at) / dayMs));
    if (index >= 0 && index < days) counts[index] = (counts[index] ?? 0) + 1;
  }
  return counts.map((n) => (n === 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : n < 5 ? 3 : 4));
}

/**
 * The strip's first and last day as `3 Oct` and `30 Oct` (UTC, the days `heatLevels` counts in).
 * The strip is drawn once with the page and the live answer holds at most 50 events, too few to
 * redraw 28 days, so it is labelled with the days it covers rather than "today".
 */
export function heatRange(now: Date, days = 28) {
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
  const today = Math.floor(now.getTime() / dayMs) * dayMs;
  return { from: day.format(today - (days - 1) * dayMs), to: day.format(today) };
}
