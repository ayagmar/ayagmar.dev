// /stats's listening, shipping, projects, typing and LLM usage panels, kept current in the
// browser (ADR 0015).
// Each panel's HTML is the build's snapshot; a newer valid answer from signals replaces it,
// rendered as the page renders it (src/pages/stats.astro; the listening and LLM usage panels
// from the same markup, src/lib/listening-panel.ts and src/lib/llm-usage-panel.ts), and every time on the page reads relative to now. Each
// panel asks at its own pace while the page is visible, and when the tab comes back once its
// last request is a minute old (src/lib/live.ts). In fixtures mode no panel has an endpoint
// and nothing is requested.

import { rabatDate } from '@min7/contracts/rabat';
import { count, describeEvent, projectsSummary, repoName } from '../data/format.ts';
import { dayName } from '../lib/history.ts';
import { readListening, renderNowPlaying } from '../lib/listening.ts';
import { listeningBody } from '../lib/listening-panel.ts';
import { live, stamp } from '../lib/live.ts';
import { readLlmUsageSnapshot } from '../lib/llm-usage.ts';
import { llmUsagePanel } from '../lib/llm-usage-panel.ts';
import { toNode } from '../lib/markup.ts';
import { knowsRabatDate } from '../lib/rabat-date.ts';
import { readProjects, readShipping, starTotals, statsWords as words } from '../lib/stats.ts';
import { bestRows, headline, readMonkeytype, relabelDays, typingWords } from '../lib/typing.ts';

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
  panel
    .querySelector('.listening-body')
    ?.replaceChildren(...listeningBody(answer.data).map(toNode));
});

// repo-pulse is pulled every 15 minutes; asking every 5 keeps the page within 20 minutes of
// the feed.
live('shipping', 5 * minute, readShipping, (panel, { data }) => {
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

// GitHub and npm are pulled every 6 hours; asking every half hour is soon enough.
live('projects', 30 * minute, readProjects, (panel, { data }) => {
  panel
    .querySelector('.projects-body')
    ?.replaceChildren(
      h('p', `${projectsSummary(data.projects)} `, link('/projects', 'See them'), '.')
    );
});

/** The day a best was set, as `<time datetime="2021-01-14" data-day>`; `relabelDays` fills it. */
function day(date: string) {
  const time = h('time') as HTMLTimeElement;
  time.dateTime = date;
  time.dataset.day = '';
  return time;
}

// Monkeytype is pulled hourly; asking every quarter hour is soon enough (ADR 0033). Its days
// are read relative to now on every tick, so they turn over at midnight with no new answer.
live(
  'monkeytype',
  15 * minute,
  readMonkeytype,
  (panel, { data }) => {
    const lead = headline(data);
    const rows = bestRows(data);
    panel
      .querySelector('.typing-body')
      ?.replaceChildren(
        ...(rows.length === 0
          ? [h('p', typingWords.none)]
          : [
              lead === null
                ? h('p', typingWords.noHeadline)
                : h('p', h('strong', lead.wpm), lead.text, day(lead.date)),
              h(
                'dl',
                ...rows.flatMap((row) => [h('dt', row.label), h('dd', row.text, day(row.date))])
              ),
              h('p', typingWords.settings),
            ])
      );
  },
  relabelDays
);

// llm-usage is pushed hourly; asking every quarter hour is soon enough. A browser that does not
// know Morocco's clock could date the snapshot a day off, so it keeps the build's. The month,
// the last 7 days, the agents and the current streak describe the date in Rabat the snapshot
// was taken: once that date has passed they are hidden until a newer snapshot comes, whether
// the build drew them or an answer did (ADR 0014). The sample in fixtures mode keeps them.
// The year's 371 cells are costly to rebuild on a phone, so an answer is drawn only when it is
// another snapshot than the one shown: the build's, most of the time, is the latest one.
const llmUsage = document.querySelector<HTMLElement>('[data-live="llm-usage"]');
let llmUsageDrawn = Date.parse(llmUsage?.dataset.fetchedAt ?? '');
live(
  'llm-usage',
  15 * minute,
  (data) => (knowsRabatDate() ? readLlmUsageSnapshot(data) : undefined),
  (panel, { data, fetchedAt, at }) => {
    if (at === llmUsageDrawn) return;
    llmUsageDrawn = at;
    panel
      .querySelector('.llm-usage-body')
      ?.replaceChildren(...llmUsagePanel(data, fetchedAt).map(toNode));
  },
  (now) => {
    if (!llmUsage?.dataset.liveSrc) return;
    const today = knowsRabatDate() ? rabatDate(now) : undefined;
    for (const block of llmUsage.querySelectorAll<HTMLElement>('[data-rabat-date]')) {
      block.hidden = block.dataset.rabatDate !== today;
    }
  }
);
