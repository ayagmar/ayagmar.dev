/**
 * What a project's row on home and /projects says beside its name (ADR 0051): drawn by the build
 * and again by the browser for each newer `/v1/projects` answer (src/scripts/project-rows.ts).
 * It imports nothing at run time, so that script carries nothing else and adds no chunk to the
 * pages that share its neighbours (the /stats JavaScript budget, ADR 0017).
 */
import type { Project } from '@min7/contracts';

/** `118`, `2.6k`: a figure read at a glance, to one decimal from a thousand up. */
const rounded = (value: number) =>
  value < 1000
    ? value.toLocaleString('en')
    : `${(Math.round(value / 100) / 10).toLocaleString('en')}k`;

/**
 * The strongest fact the snapshot entry `live` holds: stars from 10, else npm downloads over the
 * last 30 days from 100, else the latest release's tag, else nothing. Below those floors a number
 * says less than the summary next to it; without an entry there is no number to say.
 */
export function projectFact(live: Project | null): string {
  if (live === null) return '';
  if (live.stars !== null && live.stars >= 10) return `${rounded(live.stars)} stars`;
  const downloads = live.npm?.monthlyDownloads ?? null;
  if (downloads !== null && downloads >= 100) return `${rounded(downloads)} downloads a month`;
  return live.latestRelease?.tag ?? '';
}

/** The row's label: the fact, then `rest` (what the build knows: posts, archived), or only what it has. */
export const rowLabel = (fact: string, rest: string) => [fact, rest].filter(Boolean).join(', ');
