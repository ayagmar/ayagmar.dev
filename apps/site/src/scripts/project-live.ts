// A project's numbers and its log of releases and merges, kept current in the browser (ADR 0015),
// on its page and in the card under a post. Each panel's HTML is the build's snapshot; a newer
// valid answer from signals replaces it, drawn from the markup the build draws it from
// (src/lib/project-panel.ts). In fixtures mode no panel has an endpoint and nothing is requested.

import type { ProjectsSnapshot, ShippingSnapshot } from '@min7/contracts';
import type { Answer } from '../lib/live.ts';
import { live } from '../lib/live-page.ts';
import type { Markup } from '../lib/markup.ts';
import { toNode } from '../lib/markup-page.ts';
import { projectLog, projectStats } from '../lib/project-panel.ts';
import { readProjects, readShipping } from '../lib/stats.ts';

// What each panel draws now, as JSON; absent while it shows the build's HTML.
const drawn = new WeakMap<HTMLElement, string>();

/**
 * Redraws the panel's `selector` only when its markup changes. Each push to signals brings a new
 * snapshot, mostly with the same events for this project: redrawing then would close a fold the
 * reader opened and drop the focus on a link in it. The build's own snapshot is never redrawn.
 * Returns whether it drew.
 */
function redraw(panel: HTMLElement, selector: string, at: string, markup: Markup[]) {
  if (!drawn.has(panel) && at === panel.dataset.fetchedAt) return false;
  const key = JSON.stringify(markup);
  if (key === drawn.get(panel)) return false;
  drawn.set(panel, key);
  panel.querySelector(selector)?.replaceChildren(...markup.map(toNode));
  return true;
}

// GitHub and npm are pulled every 6 hours; asking every half hour is soon enough. A project the
// newest snapshot leaves out (signals had no answer for it, or it went private) says it has no
// numbers rather than keep older ones under a newer time.
live('projects', 30 * 60_000, readProjects, (panel, answer: Answer<ProjectsSnapshot>) => {
  const slug = panel.dataset.project ?? '';
  const entry = answer.data.projects.find((project) => project.slug === slug) ?? null;
  redraw(
    panel,
    '.project-numbers-body',
    answer.fetchedAt,
    projectStats({ slug, pulled: true }, entry)
  );
});

// repo-pulse is pulled every 15 minutes; asking every 5 keeps the log within 20 minutes of it.
// The log is hidden while the project has nothing in the feed, so it is never an empty box.
live('shipping', 5 * 60_000, readShipping, (panel, answer: Answer<ShippingSnapshot>) => {
  const log = projectLog(answer.data.events, panel.dataset.repos?.split(' ') ?? []);
  if (redraw(panel, '.project-log-body', answer.fetchedAt, log)) {
    panel.hidden = log.length === 0;
  }
});
