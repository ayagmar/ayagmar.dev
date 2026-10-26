// /stats's listening, shipping and projects panels, kept current in the browser (ADR 0015).
// Each panel's HTML is the build's snapshot; a newer valid answer from signals replaces it,
// rendered as the page renders it (src/pages/stats.astro), and every time on the page reads
// relative to now. In fixtures mode no panel has an endpoint and nothing is requested.
import { count, describeEvent, projectsSummary, repoName } from '../data/format.ts';
import { dayName } from '../lib/history.ts';
import { readListening, renderNowPlaying } from '../lib/listening.ts';
import { live, stamp } from '../lib/live.ts';
import {
  readProjects,
  readShipping,
  starTotals,
  weekCount,
  statsWords as words,
} from '../lib/stats.ts';

/** An element with text and element children; text is never parsed as markup. */
function h(tag: string, ...children: (Node | string)[]) {
  const element = document.createElement(tag);
  element.append(...children);
  return element;
}

function link(href: string, text: string) {
  const a = h('a', text) as HTMLAnchorElement;
  a.href = href;
  return a;
}

const minute = 60_000;

// Last.fm is pulled every minute.
live('listening', minute, readListening, (panel, answer, now) => {
  renderNowPlaying(panel.querySelector('.now-playing') as HTMLElement, answer, now);
  const { scrobbles, recent, topArtists } = answer.data;
  panel
    .querySelector('.listening-body')
    ?.replaceChildren(
      h(
        'dl',
        h('dt', words.thisWeek),
        h('dd', weekCount(scrobbles.thisWeek)),
        h('dt', words.lastWeek),
        h('dd', weekCount(scrobbles.lastWeek))
      ),
      h('h3', words.recent),
      recent.length === 0
        ? h('p', words.noRecent)
        : h(
            'ol',
            ...recent.map((track) =>
              h('li', h('cite', track.track), ` by ${track.artist}, `, stamp(track.playedAt))
            )
          ),
      h('h3', words.top),
      topArtists === null || topArtists.length === 0
        ? h('p', words.noTop)
        : h(
            'ol',
            ...topArtists.map(({ artist, plays }) => h('li', `${artist}, ${count(plays)} plays`))
          )
    );
});

// repo-pulse is pulled every 15 minutes.
live('shipping', 15 * minute, readShipping, (panel, { data }) => {
  const stars = starTotals(data);
  const time = (date: string) => {
    const element = h('time', dayName(date)) as HTMLTimeElement;
    element.dateTime = date;
    return element;
  };
  panel
    .querySelector('.shipping-body')
    ?.replaceChildren(
      data.events.length === 0
        ? h('p', words.noShipping)
        : Object.assign(
            h(
              'ul',
              ...data.events
                .slice(0, 15)
                .map((event) =>
                  h(
                    'li',
                    stamp(event.at),
                    ` ${repoName(event.repo)} `,
                    'url' in event ? link(event.url, describeEvent(event)) : describeEvent(event)
                  )
                )
            ),
            { className: 'shipping' }
          ),
      ...(stars.length === 0
        ? []
        : [
            h('h3', words.stars),
            h(
              'ul',
              ...stars.map((entry) =>
                h('li', `${repoName(entry.repo)}: ${count(entry.stars)} on `, time(entry.date))
              )
            ),
          ])
    );
});

// GitHub and npm are pulled daily; a quarter hour is soon enough.
live('projects', 15 * minute, readProjects, (panel, { data }) => {
  panel
    .querySelector('.projects-body')
    ?.replaceChildren(
      h('p', `${projectsSummary(data.projects)} `, link('/projects', 'See them'), '.')
    );
});
