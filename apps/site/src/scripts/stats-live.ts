// /stats's listening, shipping, projects, typing and LLM usage panels, kept current in the
// browser (ADR 0015).
// Each panel's HTML is the build's snapshot; a newer valid answer from signals replaces it,
// rendered from the markup the page renders it from (src/lib/listening-panel.ts,
// src/lib/stats-panels.ts and src/lib/llm-usage-panel.ts), and every time on the page reads
// relative to now. Each panel asks at its own pace while the page is visible, and when the tab
// comes back once its last request is a minute old (src/lib/live.ts). In fixtures mode no panel
// has an endpoint and nothing is requested.

import type { ListeningSnapshot } from '@min7/contracts';
import { rabatDate } from '@min7/contracts/rabat';
import { readListening, renderNowPlaying } from '../lib/listening.ts';
import { listeningBody } from '../lib/listening-panel.ts';
import { type Answer, live } from '../lib/live.ts';
import { readLlmUsageSnapshot } from '../lib/llm-usage.ts';
import { llmUsagePanel } from '../lib/llm-usage-panel.ts';
import { type Markup, toNode } from '../lib/markup.ts';
import { knowsRabatDate } from '../lib/rabat-date.ts';
import { readProjects, readShipping } from '../lib/stats.ts';
import { projectsBody, shippingBody, typingBody } from '../lib/stats-panels.ts';
import { readMonkeytype, relabelDays } from '../lib/typing.ts';

const minute = 60_000;

/**
 * Draws the panel's `selector` from `markup` only for another snapshot than the one it shows:
 * the build's at first, most of the time the latest. `live` calls again with the same snapshot
 * when it ages or a request fails; rebuilding the body then would cost a phone main-thread time
 * for nothing (mobile TBT, ADR 0017) and close a fold the reader opened.
 */
function body<Data>(
  selector: string,
  markup: (answer: Answer<Data>, panel: HTMLElement) => Markup[]
) {
  let drawn: number | undefined;
  return (panel: HTMLElement, answer: Answer<Data>) => {
    drawn ??= Date.parse(panel.dataset.fetchedAt ?? '');
    if (answer.at === drawn) return;
    drawn = answer.at;
    panel.querySelector(selector)?.replaceChildren(...markup(answer, panel).map(toNode));
  };
}

// Last.fm is pulled every minute. The now-playing line also turns on whether the answer still
// describes now, so it is redrawn every time.
const listening = body<ListeningSnapshot>('.listening-body', ({ data }) => listeningBody(data));
live('listening', minute, readListening, (panel, answer, now) => {
  renderNowPlaying(panel.querySelector('.now-playing') as HTMLElement, answer, now);
  listening(panel, answer);
});

// repo-pulse is pulled every 15 minutes; asking every 5 keeps the page within 20 minutes of
// the feed.
live(
  'shipping',
  5 * minute,
  readShipping,
  body('.shipping-body', ({ data }, panel) =>
    shippingBody(data, panel.dataset.featured?.split(' ') ?? [])
  )
);

// GitHub and npm are pulled every 6 hours; asking every half hour is soon enough.
live(
  'projects',
  30 * minute,
  readProjects,
  body('.projects-body', ({ data }) => projectsBody(data))
);

// Monkeytype is pulled hourly; asking every quarter hour is soon enough (ADR 0033). Its days
// are read relative to now on every tick, so they turn over at midnight with no new answer.
live(
  'monkeytype',
  15 * minute,
  readMonkeytype,
  body('.typing-body', ({ data }) => typingBody(data)),
  relabelDays
);

// llm-usage is pushed hourly; asking every quarter hour is soon enough. A browser that does not
// know Morocco's clock could date the snapshot a day off, so it keeps the build's. The month,
// the last 7 days, the agents and the current streak describe the date in Rabat the snapshot
// was taken: once that date has passed they are hidden until a newer snapshot comes, whether
// the build drew them or an answer did (ADR 0014). The sample in fixtures mode keeps them.
const llmUsage = document.querySelector<HTMLElement>('[data-live="llm-usage"]');
live(
  'llm-usage',
  15 * minute,
  (data) => (knowsRabatDate() ? readLlmUsageSnapshot(data) : undefined),
  body('.llm-usage-body', ({ data, fetchedAt }) => llmUsagePanel(data, fetchedAt)),
  (now) => {
    if (!llmUsage?.dataset.liveSrc) return;
    const today = knowsRabatDate() ? rabatDate(now) : undefined;
    for (const block of llmUsage.querySelectorAll<HTMLElement>('[data-rabat-date]')) {
      block.hidden = block.dataset.rabatDate !== today;
    }
  }
);
