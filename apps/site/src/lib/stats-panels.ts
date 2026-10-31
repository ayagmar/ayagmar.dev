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
import { count, describeEvent, projectsSummary, repoName } from '../data/format.ts';
import { dayName } from './history.ts';
import { el, type Markup, stampMarkup } from './markup.ts';
import { starTotals, statsWords as words } from './stats.ts';
import { bestRows, dayDate, headline, typingWords } from './typing.ts';

/**
 * The first `keep` items of a list, then the rest in a disclosure that opens without
 * JavaScript, so a long panel stays short on a phone and nothing is out of reach.
 */
export function capped(
  tag: 'ul' | 'ol',
  attrs: Record<string, string>,
  items: Markup[],
  keep: number,
  more: (rest: number) => string
): Markup[] {
  const shown = el(tag, attrs, ...items.slice(0, keep));
  if (items.length <= keep) return [shown];
  const rest = el(
    tag,
    tag === 'ol' ? { ...attrs, start: String(keep + 1) } : attrs,
    ...items.slice(keep)
  );
  return [
    shown,
    el('details', { class: 'more' }, el('summary', {}, more(items.length - keep)), rest),
  ];
}

// The time, then the event in one element, so the two make the log's columns (base.css).
const shippingItem = (event: ShippingEvent) =>
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

/** The shipping events as a log: all of `events`, or the first `keep` and the rest folded. */
export const shippingList = (events: readonly ShippingEvent[], keep = events.length) =>
  capped('ul', { class: 'shipping log' }, events.map(shippingItem), keep, (rest) =>
    rest === 1 ? '1 earlier event' : `${rest} earlier events`
  );

/**
 * /stats's shipping body: the 15 latest events, 5 open, then the star counts of the
 * repositories that are not `featured` (`owner/name`). The projects window counts the featured
 * ones from its own, fresher source, so a repository never shows two counts on one page.
 */
export function shippingBody(data: ShippingSnapshot, featured: readonly string[]): Markup[] {
  const stars = starTotals(data).filter((entry) => !featured.includes(entry.repo));
  return [
    ...(data.events.length === 0
      ? [el('p', {}, words.noShipping)]
      : shippingList(data.events.slice(0, 15), 5)),
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
                  `${count(entry.stars)} ${entry.stars === 1 ? 'star' : 'stars'} on `,
                  el('time', { datetime: entry.date }, dayName(entry.date))
                )
              )
            ),
            5,
            (rest) => (rest === 1 ? '1 more repository' : `${rest} more repositories`)
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
                el(
                  'span',
                  { class: 'row-value' },
                  `${count(project.stars ?? 0)} ${project.stars === 1 ? 'star' : 'stars'}`
                )
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
const bestDay = (date: string) => el('time', { datetime: date, 'data-day': '' }, dayDate(date));

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
