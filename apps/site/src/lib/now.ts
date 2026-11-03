import type { BrewingItem } from './now-schema.ts';
import { nowPage, site, siteUrl } from './site.ts';

/** A /now page not updated for this long says it may be out of date (ADR 0035). */
export const staleAfterDays = 90;

const dayMs = 24 * 60 * 60 * 1000;

/** The first instant (ms) at which a page last updated on `updated` (`YYYY-MM-DD`, UTC) is stale. */
export const staleFrom = (updated: string) => Date.parse(updated) + staleAfterDays * dayMs + 1;

/** Whether the page is stale at `now` (ms): more than 90 days after `updated`. */
export const isStale = (updated: string, now: number) => now >= staleFrom(updated);

/** `30 October 2026`: the day /now was last updated, as the page and its plain text say it. */
export const updatedOn = (updated: Date) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(updated);

export const brewingTitle = 'Currently brewing';

/**
 * /now as plain text, what `curl ayagmar.dev/now` prints (worker/index.ts): the same frontmatter
 * and Markdown body the page renders, the body left as Markdown, which reads as text.
 */
export function renderNowText(
  { updated, brewing }: { updated: Date; brewing: readonly BrewingItem[] },
  body: string
): string {
  const rule = '-'.repeat(72);
  const items = brewing.flatMap((item) => [
    `  ${item.name}`,
    `    ${item.note}`,
    ...(item.url === undefined ? [] : [`    ${item.url}`]),
  ]);
  return [
    `${nowPage.label} | ${site.name}`,
    `Updated ${updatedOn(updated)}.`,
    rule,
    ...(items.length === 0 ? [] : [brewingTitle, ...items, rule]),
    body.trim(),
    rule,
    `  ${'Home'.padEnd(10)} ${siteUrl}`,
    '',
  ].join('\n');
}
