/**
 * The bodies of /stats's shipping, projects and typing panels, and the shipping list home
 * shows: drawn by the build (src/pages/stats.astro, src/components/ShippingList.astro) and again
 * by the browser for each newer answer (src/scripts/stats-live.ts), from this one markup.
 */
import type {
  MonkeytypeSnapshot,
  ProjectsSnapshot,
  ShippingEvent,
  ShippingSnapshot,
} from '@min7/contracts';
import { describeEvent, projectsSummary } from '../data/format.ts';
import { capped } from './capped.ts';
import { dayName, shortDate } from './day-words.ts';
import { el, type Markup, stampMarkup } from './markup.ts';
import { plural } from './plural.ts';
import { starTotals, statsWords as words } from './stats.ts';
import { bestRows, headline, typingWords } from './typing.ts';
import { repoName } from './words.ts';

// The time, then the event in one element, so the two make the log's columns (base.css).
export const shippingItem = (event: ShippingEvent) =>
  el(
    'li',
    {},
    stampMarkup(event.at),
    ' ',
    el(
      'span',
      {},
      el('span', { class: 'repo' }, repoName(event.repo)),
      ' ',
      'url' in event ? el('a', { href: event.url }, describeEvent(event)) : describeEvent(event)
    )
  );

/**
 * A merge that only updates dependencies, `chore(deps)` or `chore(deps-dev)`: how Renovate titles
 * them here, and Dependabot when set to Conventional Commits. /v1/shipping has no author, so
 * signals' bot list (ADR 0046) cannot be used; the title is all there is (ADR 0052).
 */
const dependencyUpdate = /^chore\(deps/;

/**
 * The events a shipping log shows: dependency updates left out, so the log says what was built.
 * Counts, the strip, day and year pages read the history and keep them.
 */
export const shippingLog = (events: readonly ShippingEvent[]) =>
  events.filter((event) => event.type !== 'merge' || !dependencyUpdate.test(event.title));

// Here rather than in statsWords: that chunk has its own allowance and no room (budgets.json).
const onlyDependencyUpdates = 'Only dependency updates lately.';

/** The shipping events as a log: all of `events`, or the first `keep` and the rest folded. */
export const shippingList = (events: readonly ShippingEvent[], keep = events.length) =>
  capped('ul', { class: 'shipping log' }, events.map(shippingItem), keep, (rest) =>
    plural(rest, 'earlier event', 'earlier events')
  );

/**
 * /stats's shipping body: the 15 latest events of the log (`shippingLog`), 5 open, then the star
 * counts of the repositories that are not `featured` (`owner/name`). The projects window counts
 * the featured ones from its own, fresher source, so a repository never shows two counts on one
 * page.
 */
export function shippingBody(data: ShippingSnapshot, featured: readonly string[]): Markup[] {
  const stars = starTotals(data).filter((entry) => !featured.includes(entry.repo));
  const log = shippingLog(data.events);
  return [
    ...(data.events.length === 0
      ? [el('p', {}, words.noShipping)]
      : log.length === 0
        ? [el('p', {}, onlyDependencyUpdates)]
        : shippingList(log.slice(0, 15), 5)),
    ...(stars.length === 0
      ? []
      : [
          el('h3', {}, words.stars),
          ...capped(
            'ul',
            { class: 'rows' },
            stars.map((entry) =>
              el(
                'li',
                {},
                el('span', {}, repoName(entry.repo)),
                el(
                  'span',
                  { class: 'row-value' },
                  `${plural(entry.stars, 'star', 'stars')} on `,
                  el('time', { datetime: entry.date }, dayName(entry.date))
                )
              )
            ),
            5,
            (rest) => plural(rest, 'more repository', 'more repositories')
          ),
        ]),
  ];
}

/** /stats's projects body: the five featured projects with the most stars, then the totals. */
export function projectsBody({ projects }: ProjectsSnapshot): Markup[] {
  const top = [...projects]
    .filter((project) => project.stars !== null)
    .sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0))
    .slice(0, 5);
  return [
    ...(top.length === 0
      ? []
      : [
          el(
            'ol',
            { class: 'rows' },
            ...top.map((project) =>
              el(
                'li',
                {},
                el('a', { href: `/projects/${project.slug}` }, project.slug),
                el('span', { class: 'row-value' }, plural(project.stars ?? 0, 'star', 'stars'))
              )
            )
          ),
        ]),
    el(
      'p',
      {},
      `${projectsSummary(projects)} `,
      el('a', { href: '/projects' }, 'All projects'),
      '.'
    ),
  ];
}

/** The day a best was set; the page's script reads it relative to now (`relabelDays`). */
const bestDay = (date: string) => el('time', { datetime: date, 'data-day': '' }, shortDate(date));

/** /stats's typing body: the 60-second best as a sentence, then one aligned row per best. */
export function typingBody(data: MonkeytypeSnapshot): Markup[] {
  const rows = bestRows(data);
  if (rows.length === 0) return [el('p', {}, typingWords.none)];
  const lead = headline(data);
  return [
    lead === null
      ? el('p', {}, typingWords.noHeadline)
      : el('p', {}, el('strong', {}, lead.wpm), lead.text, bestDay(lead.date)),
    el(
      'dl',
      { class: 'bests' },
      ...rows.map((row) =>
        el(
          'div',
          {},
          el('dt', {}, row.label),
          el(
            'dd',
            {},
            el('span', { class: 'wpm' }, row.wpm),
            ' ',
            el('span', {}, row.acc),
            ' ',
            bestDay(row.date)
          )
        )
      )
    ),
    el('p', { class: 'fine-print' }, typingWords.settings),
  ];
}
