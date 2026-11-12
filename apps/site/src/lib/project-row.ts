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
 * The version in a release tag that also names its package, as monorepo tools write them:
 * `modmgr--v0.5.0`, `pkg@1.2.3`, `pkg-v1.2.3` say `v0.5.0`, `v1.2.3`. Any other tag, a plain
 * `v0.1.5` included, is said as it is. The project page's log keeps the tag GitHub shows.
 */
function tagVersion(tag: string): string {
  const version = /^.+?(?:--|@|-)v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/.exec(tag)?.[1];
  return version === undefined ? tag : `v${version}`;
}

/**
 * The strongest fact the snapshot entry `live` holds: stars from 10, else npm downloads over the
 * last 30 days from 100, else the latest release's version, else nothing. Below those floors a number
 * says less than the summary next to it; without an entry there is no number to say.
 */
export function projectFact(live: Project | null): string {
  if (live === null) return '';
  if (live.stars !== null && live.stars >= 10) return `${rounded(live.stars)} stars`;
  const downloads = live.npm?.monthlyDownloads ?? null;
  if (downloads !== null && downloads >= 100) return `${rounded(downloads)} downloads a month`;
  const tag = live.latestRelease?.tag;
  return tag === undefined ? '' : tagVersion(tag);
}

/** The row's label: the fact, then `rest` (what the build knows: posts, archived), or only what it has. */
export const rowLabel = (fact: string, rest: string) => [fact, rest].filter(Boolean).join(', ');
