/**
 * Day pages and receipts (ADR 0038): what the daily history and the published
 * writing say about one date, one project or one post's range, counted and worded once here.
 * The pages only render it. Each series keeps its own calendar: shipping days are UTC dates,
 * agent usage days are dates in Rabat, so a date's page shows each under its own day.
 */
import {
  featuredProjects,
  type LlmUsageDay,
  type ProjectSlug,
  type ShippingActivityDay,
} from '@min7/contracts';
import { count, repoName } from '../data/format.ts';
import { hours, tokens } from './llm-usage-panel.ts';
import { projectPath } from './projects.ts';

/** The history the build read; a series is null when it could not be read whole. */
export interface History {
  /** Recorded shipping days, UTC dates, oldest first. */
  shipping: readonly ShippingActivityDay[] | null;
  /** Recorded agent usage days, dates in Rabat, oldest first. */
  usage: readonly LlmUsageDay[] | null;
}

/** A post or note, as a day page lists it. */
export interface Published {
  /** Its `date`, `YYYY-MM-DD`. */
  date: string;
  title: string;
  path: string;
  kind: 'Post' | 'Note';
}

type Counts = Pick<ShippingActivityDay, 'pushes' | 'commits' | 'merges' | 'releases' | 'stars'>;

export const dayPath = (date: string) => `/day/${date}`;

const plural = (value: number, one: string, many: string) =>
  `${count(value)} ${value === 1 ? one : many}`;

const at = (date: string) => Date.parse(`${date}T00:00:00Z`);
const longDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const shortDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** `12 Oct 2026`. */
const short = (date: string) => shortDate.format(at(date));

/** `12–26 Oct 2026`, `28 Sept–4 Oct 2026`, `28 Dec 2026–3 Jan 2027`, or `12 Oct 2026`. */
function range(from: string, to: string): string {
  if (from === to) return short(from);
  if (from.slice(0, 4) !== to.slice(0, 4)) return `${short(from)}–${short(to)}`;
  const start =
    from.slice(0, 7) === to.slice(0, 7)
      ? String(Number(from.slice(8)))
      : short(from).replace(/ \d{4}$/, '');
  return `${start}–${short(to)}`;
}

/** What shipped, `2 merges · 5 commits in 1 push · 1 release · 3 stars`; empty for nothing. */
function shipped({ merges, commits, pushes, releases, stars }: Counts): string {
  return [
    merges > 0 && plural(merges, 'merge', 'merges'),
    pushes > 0 && `${plural(commits, 'commit', 'commits')} in ${plural(pushes, 'push', 'pushes')}`,
    releases > 0 && plural(releases, 'release', 'releases'),
    stars > 0 && plural(stars, 'star', 'stars'),
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Pushes, merges and releases: what the strip counts as shipping (stars are attention). */
const shipping = (day: Counts) => day.pushes + day.merges + day.releases;

const repoHref = (repo: string) => {
  const project = featuredProjects.find((entry) => entry.repo === repo);
  return project === undefined ? `https://github.com/${repo}` : projectPath(project.slug);
};

/** The shipping half of a day page: a line when there is nothing to list, else the counts. */
type ShippingSection =
  | { empty: string }
  | {
      empty: null;
      total: string;
      repos: { repo: string; href: string; counts: string }[];
      /** Said when the day's counts include repositories it does not name. */
      unnamed: string | null;
    };

/** The agent usage half: a line when there is nothing to say, else the numbers. */
type UsageSection = { empty: string } | { empty: null; tokens: string; time: string | null };

interface DayLink {
  path: string;
  /** `25 October 2026`. */
  title: string;
}

export interface DayPage {
  date: string;
  /** `26 October 2026`. */
  title: string;
  description: string;
  shipping: ShippingSection;
  usage: UsageSection;
  published: Published[];
  /** The neighbouring dates that have a page. */
  previous: DayLink | null;
  next: DayLink | null;
}

/** Which calendar each series counts in, for the line under its heading. */
export const dayZones = {
  shipping: 'Counted over the UTC day.',
  usage: 'Counted over the day in Rabat (Africa/Casablanca).',
} as const;

function shippingSection(day: ShippingActivityDay | undefined): ShippingSection {
  if (day === undefined) return { empty: 'No shipping recorded for this date.' };
  const total = shipped(day);
  if (total === '') return { empty: 'Nothing shipped.' };
  const repos = day.repos.flatMap((entry) => {
    const counts = shipped(entry);
    return counts === '' ? [] : [{ repo: entry.repo, href: repoHref(entry.repo), counts }];
  });
  return {
    empty: null,
    total,
    repos,
    unnamed: day.reposComplete ? null : 'Some of it was in repositories not named here.',
  };
}

function usageSection(day: LlmUsageDay | undefined): UsageSection {
  if (day === undefined) return { empty: 'No agent usage recorded for this date.' };
  if (day.totalTokens === 0 && !day.activeMs) return { empty: 'No agent use.' };
  return {
    empty: null,
    tokens: `${tokens(day.totalTokens)} tokens`,
    // Absent is unknown, not none (ADR 0014).
    time: day.activeMs === undefined ? null : `${hours(day.activeMs)} of agent time, estimated`,
  };
}

/**
 * One page per date that has a recorded day in either series or a post or note published on
 * it, oldest first, each linked to its neighbours.
 */
export function dayPages(history: History, published: readonly Published[]): DayPage[] {
  const shippingDays = new Map(history.shipping?.map((day) => [day.date, day]));
  const usageDays = new Map(history.usage?.map((day) => [day.date, day]));
  const dates = [
    ...new Set([...shippingDays.keys(), ...usageDays.keys(), ...published.map((p) => p.date)]),
  ].sort();
  const link = (date: string | undefined) =>
    date === undefined ? null : { path: dayPath(date), title: longDate.format(at(date)) };
  return dates.map((date, index) => {
    const title = longDate.format(at(date));
    return {
      date,
      title,
      description: `What shipped, how much the coding agents ran, and what was published on ${title}.`,
      shipping: shippingSection(shippingDays.get(date)),
      usage: usageSection(usageDays.get(date)),
      published: published.filter((entry) => entry.date === date),
      previous: link(dates[index - 1]),
      next: link(dates[index + 1]),
    };
  });
}

/**
 * A project's receipt: `12 merges · 40 commits · 2 releases since 12 Oct 2026`, its repository's
 * counts over every recorded shipping day. Null without a recorded day. Agent tokens are not
 * counted per repository, so a project's receipt has none.
 */
export function projectReceipt(history: History, repo: string): string | null {
  const days = history.shipping;
  const first = days?.[0];
  if (days == null || first === undefined) return null;
  let merges = 0;
  let commits = 0;
  let releases = 0;
  for (const day of days) {
    const entry = day.repos.find((candidate) => candidate.repo === repo);
    if (entry === undefined) continue;
    merges += entry.merges;
    commits += entry.commits;
    releases += entry.releases;
  }
  return `${plural(merges, 'merge', 'merges')} · ${plural(commits, 'commit', 'commits')} · ${plural(releases, 'release', 'releases')} since ${short(first.date)}`;
}

/** A post's `receipts` frontmatter, dates as `YYYY-MM-DD`. */
export interface ReceiptsRange {
  from: string;
  to: string;
  repos?: readonly string[] | undefined;
}

/** The repositories of a post's `projects`, the default filter of its receipt. */
export const projectRepos = (slugs: readonly ProjectSlug[]) =>
  slugs.flatMap((slug) => featuredProjects.find((entry) => entry.slug === slug)?.repo ?? []);

/**
 * A post's receipt over its `receipts` range, both ends included: PRs merged and commits in
 * `repos` (else in `defaultRepos`, the post's projects, else everywhere), agent tokens (never
 * per repository), and the days with either. Shipping counts UTC dates and agent usage dates in
 * Rabat, each from its own history. A series with no recorded day in the range is left out,
 * never shown as 0, and the line says when the range has days without a record. Null when
 * neither series recorded a day in it.
 */
export function postReceipt(
  history: History,
  receipts: ReceiptsRange,
  defaultRepos: readonly string[]
): string | null {
  const { from, to } = receipts;
  const repos = receipts.repos ?? (defaultRepos.length > 0 ? defaultRepos : null);
  const within = (day: { date: string }) => day.date >= from && day.date <= to;
  const shippingDays = history.shipping?.filter(within) ?? [];
  const usageDays = history.usage?.filter(within) ?? [];
  if (shippingDays.length === 0 && usageDays.length === 0) return null;

  const active = new Set<string>();
  const parts: string[] = [];
  if (shippingDays.length > 0) {
    let merges = 0;
    let commits = 0;
    for (const day of shippingDays) {
      const counted = repos === null ? [day] : day.repos.filter((r) => repos.includes(r.repo));
      for (const entry of counted) {
        merges += entry.merges;
        commits += entry.commits;
        if (shipping(entry) > 0) active.add(day.date);
      }
    }
    parts.push(plural(merges, 'PR merged', 'PRs merged'), plural(commits, 'commit', 'commits'));
  }
  if (usageDays.length > 0) {
    const total = usageDays.reduce((sum, day) => sum + day.totalTokens, 0);
    for (const day of usageDays) if (day.totalTokens > 0) active.add(day.date);
    parts.push(`${tokens(total)} agent tokens${repos === null ? '' : ' in all'}`);
  }
  parts.push(plural(active.size, 'active day', 'active days'));

  const length = (at(to) - at(from)) / 86_400_000 + 1;
  const gaps = shippingDays.length < length || usageDays.length < length;
  const where = repos === null ? '' : `, ${repos.map(repoName).join(', ')}`;
  return `${range(from, to)}${where}: ${parts.join(' · ')}${gaps ? ' (some days have no record)' : ''}`;
}
