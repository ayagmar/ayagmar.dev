/**
 * A project's numbers and its log of releases and merges: drawn by the build (ProjectStats.astro,
 * src/pages/projects/[slug].astro) and again by the browser for each newer answer from
 * `/v1/projects` or `/v1/shipping` (src/scripts/project-live.ts), from this one markup.
 */
import type { Project, ShippingEvent } from '@min7/contracts';
import { describeEvent, projectFacts } from '../data/format.ts';
import { capped, el, type Markup, stampMarkup } from './markup.ts';
import { plural } from './plural.ts';

/** What a project's page says in place of numbers it has none of. */
export const noNumbers = ({ slug, pulled }: { slug: string; pulled: boolean }) =>
  pulled ? `No live numbers for ${slug} right now.` : `I don't fetch numbers for ${slug}.`;

/**
 * The project's numbers from its snapshot entry `live` (null when the snapshot has none for it),
 * or the line that says it has none.
 */
export function projectStats(project: { slug: string; pulled: boolean }, live: Project | null) {
  const facts = projectFacts({ live });
  if (facts.length === 0) return [el('p', { class: 'project-stats-empty' }, noNumbers(project))];
  return [
    el(
      'dl',
      { class: 'project-stats' },
      // A pair per `div`, which the grid sees through (base.css), as markupLines reads a term with its definition.
      ...facts.map((fact) =>
        el(
          'div',
          {},
          el('dt', {}, fact.label),
          el(
            'dd',
            {},
            ...('release' in fact
              ? [
                  el('a', { href: fact.release.url }, fact.release.tag),
                  ', ',
                  el('time', { datetime: fact.release.publishedAt }, fact.release.day),
                ]
              : [fact.value])
          )
        )
      )
    ),
  ];
}

/**
 * The releases and merges in `events` whose repository is one of `repos`, newest first as the
 * feed gives them. `repos` holds the name in contracts and the one GitHub reports now, since a
 * renamed repository's older events keep its old name; GitHub treats names without case.
 */
export function projectEvents(events: readonly ShippingEvent[], repos: readonly string[]) {
  const names = new Set(repos.map((repo) => repo.toLowerCase()));
  return events.filter(
    (event): event is Extract<ShippingEvent, { type: 'release' | 'merge' }> =>
      (event.type === 'release' || event.type === 'merge') && names.has(event.repo.toLowerCase())
  );
}

/** The project's log, time first (ADR 0037), five open and the rest folded; empty for none. */
export function projectLog(events: readonly ShippingEvent[], repos: readonly string[]): Markup[] {
  const items = projectEvents(events, repos).map((event) =>
    el(
      'li',
      {},
      stampMarkup(event.at),
      ' ',
      el('span', {}, el('a', { href: event.url }, describeEvent(event)))
    )
  );
  return items.length === 0
    ? []
    : capped('ul', { class: 'log' }, items, 5, (rest) =>
        plural(rest, 'earlier one', 'earlier ones')
      );
}
