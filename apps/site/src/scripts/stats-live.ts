// /stats's listening, shipping, projects, typing and LLM usage panels, kept current in the
// browser (ADR 0015).
// Each panel's HTML is the build's snapshot; a newer valid answer from signals replaces it,
// rendered from the markup the page renders it from (src/lib/listening-panel.ts,
// src/lib/stats-panels.ts and src/lib/llm-usage-panel.ts), and every time on the page reads
// relative to now. Each panel asks at its own pace while the page is visible, and when the tab
// comes back once its last request is a minute old (src/lib/live.ts). In fixtures mode no panel
// has an endpoint and nothing is requested.

import { rabatDate } from '@min7/contracts/rabat';
import { readListening, renderNowPlaying } from '../lib/listening.ts';
import { listeningBody } from '../lib/listening-panel.ts';
import { live } from '../lib/live.ts';
import { readLlmUsageSnapshot } from '../lib/llm-usage.ts';
import { llmUsagePanel } from '../lib/llm-usage-panel.ts';
import { toNode } from '../lib/markup.ts';
import { knowsRabatDate } from '../lib/rabat-date.ts';
import { readProjects, readShipping } from '../lib/stats.ts';
import { projectsBody, shippingBody, typingBody } from '../lib/stats-panels.ts';
import { readMonkeytype, relabelDays } from '../lib/typing.ts';

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
  const featured = panel.dataset.featured?.split(' ') ?? [];
  panel
    .querySelector('.shipping-body')
    ?.replaceChildren(...shippingBody(data, featured).map(toNode));
});

// GitHub and npm are pulled every 6 hours; asking every half hour is soon enough.
live('projects', 30 * minute, readProjects, (panel, { data }) => {
  panel.querySelector('.projects-body')?.replaceChildren(...projectsBody(data).map(toNode));
});

// Monkeytype is pulled hourly; asking every quarter hour is soon enough (ADR 0033). Its days
// are read relative to now on every tick, so they turn over at midnight with no new answer.
live(
  'monkeytype',
  15 * minute,
  readMonkeytype,
  (panel, { data }) => {
    panel.querySelector('.typing-body')?.replaceChildren(...typingBody(data).map(toNode));
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
