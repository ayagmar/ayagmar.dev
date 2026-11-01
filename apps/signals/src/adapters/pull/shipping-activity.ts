// repo-pulse daily activity (ADR 0038): public activity per UTC day, kept as daily history.
import {
  activityMaxDays,
  activityMaxRepos,
  activityRecentDays,
  type RepoPulseActivityDay,
  repoFullNamePattern,
  repoPulseActivityReaderSchema,
  type ShippingActivityStoredDay,
  shippingActivitySnapshotSchema,
} from '@min7/contracts';
import { rabatDate, rabatDayStart } from '@min7/contracts/rabat';
import { D1SnapshotStore } from '../../storage/d1.ts';
import type { DailyRow } from '../../storage/daily.ts';
import type { SourceStatus } from '../../storage/types.ts';
import type { HistoryAdapter, StoredHistory } from '../types.ts';
import { checkSnapshot, getJson, PullError, parseBody, type UpstreamResponse } from './http.ts';

const activityUrl = 'https://repo-pulse.ayagmar.workers.dev/public/activity';
// 400 days with a handful of repositories each is about 100 KiB; 50 on every day would be more,
// and is not a day this account has.
const maxBytes = 512 * 1024;

/** A normalized activity answer. */
export interface ShippingActivityPull {
  /** repo-pulse's `generatedAt`, as UTC with milliseconds. */
  fetchedAt: string;
  /** The UTC date of the answer's last day when it is the whole 400 days, else null. */
  wholeOn: string | null;
  since: string | null;
  /** Every repository the answer names on any day. */
  repos: ReadonlySet<string>;
  /** The days from `since` on, oldest first. */
  days: { day: string; data: ShippingActivityStoredDay }[];
}

const dayMs = 24 * 60 * 60 * 1000;
const intervalMs = 60 * 60 * 1000;
/**
 * After a `complete: false` answer: repo-pulse's visibility gate stays warm for 60 seconds, and
 * an attempt this soon finds most of what it learned still there (ADR 0038).
 */
const incompleteRetryMs = 2 * 60 * 1000;
/**
 * The first minutes of a date in Rabat belong to the listening history, which every other due
 * source delays by a minute (ADR 0030); this pull waits until they are over.
 */
const midnightYieldMs = 15 * 60 * 1000;
const counts = ['pushes', 'commits', 'merges', 'releases', 'stars'] as const;

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1_000_000;

const isDate = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

type Counts = Record<(typeof counts)[number], number>;

/** The five counts of `value`, or null when one is not a whole number from 0 to 1,000,000. */
function readCounts(value: Record<string, unknown>): Counts | null {
  const { pushes, commits, merges, releases, stars } = value;
  return isCount(pushes) &&
    isCount(commits) &&
    isCount(merges) &&
    isCount(releases) &&
    isCount(stars)
    ? { pushes, commits, merges, releases, stars }
    : null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * One day as `repoPulseActivityDaySchema` reads it, unknown keys dropped, or null. Written out
 * because zod in workerd takes milliseconds over 400 days; `test/pull-normalize.test.ts` holds
 * it to the schema.
 */
export function readActivityDay(value: unknown): RepoPulseActivityDay | null {
  if (!isRecord(value) || !isDate(value.date) || typeof value.reposTruncated !== 'boolean') {
    return null;
  }
  const dayCounts = readCounts(value);
  if (dayCounts === null || !Array.isArray(value.repos) || value.repos.length > activityMaxRepos) {
    return null;
  }
  const repos: RepoPulseActivityDay['repos'] = [];
  for (const item of value.repos) {
    if (!isRecord(item) || typeof item.repo !== 'string' || !repoFullNamePattern.test(item.repo)) {
      return null;
    }
    const repoCounts = readCounts(item);
    if (repoCounts === null) return null;
    repos.push({ repo: item.repo, ...repoCounts });
  }
  return { date: value.date, ...dayCounts, repos, reposTruncated: value.reposTruncated };
}

/**
 * Whether `days` are a window signals asks for: exactly 35 or 400, one per date, oldest
 * first, ending with the UTC date of `generatedAt`; each day's repositories sorted and named
 * once, and the day's counts their sums (or more, when the list was cut at 50).
 */
function isWholeWindow(generatedAt: string, days: readonly RepoPulseActivityDay[]): boolean {
  if (days.length !== activityRecentDays && days.length !== activityMaxDays) return false;
  const last = Math.floor(Date.parse(generatedAt) / dayMs);
  return days.every((day, index) => {
    const date = new Date((last - (days.length - 1 - index)) * dayMs).toISOString().slice(0, 10);
    if (day.date !== date) return false;
    if (day.repos.some((repo, i) => i > 0 && !((day.repos[i - 1]?.repo ?? '') < repo.repo))) {
      return false;
    }
    return counts.every((key) => {
      const sum = day.repos.reduce((total, repo) => total + repo[key], 0);
      return day.reposTruncated ? day[key] >= sum : day[key] === sum;
    });
  });
}

/** Whether a day holds nothing: what every day before `since` must be. */
const isEmpty = (day: RepoPulseActivityDay) =>
  day.repos.length === 0 && !day.reposTruncated && counts.every((key) => day[key] === 0);

const sumOf = (repos: readonly Counts[]): Counts => {
  const sum: Counts = { pushes: 0, commits: 0, merges: 0, releases: 0, stars: 0 };
  for (const repo of repos) for (const key of counts) sum[key] += repo[key];
  return sum;
};

const maxOf = (...values: Counts[]): Counts => {
  const [first, ...rest] = values;
  const max: Counts = { pushes: 0, commits: 0, merges: 0, releases: 0, stars: 0 };
  for (const key of counts) max[key] = Math.max(first?.[key] ?? 0, ...rest.map((v) => v[key]));
  return max;
};

const busiest = (a: Counts, b: Counts) => counts.reduce((sum, key) => sum + b[key] - a[key], 0);

/**
 * A stored day and a newer answer's day of the same date, merged (ADR 0038): each repository's
 * every count is the larger of the two, a repository the answer leaves out keeps what it had
 * (repo-pulse drops one made private, which is not less activity), and each day count is the
 * largest of the two days' and its repositories' sum. When more than 50 repositories result,
 * the 50 busiest are listed. `reposTruncated` says the counts include repositories not listed.
 */
function mergeDay(
  stored: ShippingActivityStoredDay,
  answer: ShippingActivityStoredDay
): ShippingActivityStoredDay {
  const byName = new Map(stored.repos.map((repo) => [repo.repo, repo]));
  for (const repo of answer.repos) {
    const before = byName.get(repo.repo);
    byName.set(
      repo.repo,
      before === undefined ? repo : { repo: repo.repo, ...maxOf(before, repo) }
    );
  }
  let repos = [...byName.values()];
  const total = maxOf(stored, answer, sumOf(repos));
  const cut = repos.length > activityMaxRepos;
  if (cut) repos = repos.toSorted(busiest).slice(0, activityMaxRepos);
  repos.sort((a, b) => (a.repo < b.repo ? -1 : 1));
  const listed = sumOf(repos);
  return {
    ...total,
    repos,
    reposTruncated: cut || counts.some((key) => total[key] > listed[key]),
  };
}

/**
 * The snapshot and the days to write for `pull`, given what is stored. A day the answer
 * leaves as stored is not written. The repositories that may be named: a whole answer's own;
 * after a 35-day answer, the stored ones and its own, less those a stored day of its window
 * lists but the answer names nowhere (made private, ADR 0038).
 */
function merge(pull: ShippingActivityPull, stored: StoredHistory) {
  const before = shippingActivitySnapshotSchema.safeParse(stored.snapshot);
  const days: DailyRow[] = [];
  const gone = new Set<string>();
  for (const { day, data } of pull.days) {
    const json = JSON.stringify(data);
    const old = stored.days.get(day);
    if (old === json) continue;
    if (old === undefined) {
      days.push({ day, json });
      continue;
    }
    // Written by this function from a checked answer.
    const oldDay = JSON.parse(old) as ShippingActivityStoredDay;
    for (const { repo } of oldDay.repos) if (!pull.repos.has(repo)) gone.add(repo);
    const merged = JSON.stringify(mergeDay(oldDay, data));
    if (merged !== old) days.push({ day, json: merged });
  }
  const repos = new Set(pull.repos);
  if (pull.wholeOn === null && before.success) {
    for (const repo of before.data.repos) if (!gone.has(repo)) repos.add(repo);
  }
  const snapshot = checkSnapshot(shippingActivitySnapshotSchema, {
    since: pull.since,
    repos: [...repos].sort(),
    fullOn: pull.wholeOn ?? (before.success ? before.data.fullOn : null),
  });
  return { snapshot, days };
}

const utcDate = (time: number) => new Date(time).toISOString().slice(0, 10);

/**
 * Whether the last attempt recorded neither a failure nor a success: the run was cut off. An
 * attempt that stored nothing because its answer was not newer looks the same; it only makes
 * the next pull a 35-day one.
 */
const endedSilently = (status: SourceStatus | undefined) =>
  status?.lastAttemptAt != null &&
  status.lastErrorCode === null &&
  (status.lastSuccessAt === null || Date.parse(status.lastSuccessAt) < status.lastAttemptAt);

const isIncomplete = ({ status, body }: UpstreamResponse) =>
  status === 200 && isRecord(body) && body.complete === false;

export const shippingActivity: HistoryAdapter<UpstreamResponse, ShippingActivityPull> = {
  id: 'shipping-activity',
  intervalSeconds: intervalMs / 1000,

  /**
   * An hour after the last attempt, two minutes after an incomplete answer, and never in the
   * first minutes of a date in Rabat.
   */
  dueAt(status) {
    const wait = status.lastErrorCode === 'upstream_incomplete' ? incompleteRetryMs : intervalMs;
    const due = (status.lastAttemptAt ?? 0) + wait;
    return Math.max(due, rabatDayStart(rabatDate(due)) * 1000 + midnightYieldMs);
  },

  /**
   * The whole 400 days on the first pull of a UTC date, and the last 35 on the others, which
   * cost less CPU to check and merge (ADR 0038); 35 too after a pull that ended without
   * recording how, as one cut off by the CPU limit does, so the series still advances. An
   * incomplete answer is asked for once more at once, while repo-pulse's gate is warm.
   */
  async fetch(env, signal, previous) {
    const stored = await new D1SnapshotStore(env.DB).get('shipping-activity');
    const fullOn = (stored?.snapshot as { fullOn?: unknown } | null | undefined)?.fullOn;
    const whole = fullOn !== utcDate(Date.now()) && !endedSilently(previous);
    const days = whole ? activityMaxDays : activityRecentDays;
    const url = `${activityUrl}?days=${days}`;
    const answer = await getJson(url, { signal, maxBytes });
    return isIncomplete(answer) ? getJson(url, { signal, maxBytes }) : answer;
  },

  /**
   * The answer is all or nothing: these days are kept for good, so one that is not a whole
   * window, that repo-pulse marks incomplete, or whose days contradict its `since`, is refused
   * rather than partly stored. Days before `since` are not recorded, so they are left out,
   * never stored as zeros.
   */
  normalize(raw) {
    const answer = parseBody(raw, repoPulseActivityReaderSchema);
    if (!answer.complete) throw new PullError('upstream_incomplete');
    const days = answer.days.map(readActivityDay).filter((day) => day !== null);
    if (days.length !== answer.days.length || !isWholeWindow(answer.generatedAt, days)) {
      throw new PullError('upstream_malformed');
    }
    const { since } = answer;
    const last = days.at(-1)?.date ?? '';
    const unrecorded = since === null ? days : days.filter((day) => day.date < since);
    if ((since !== null && since > last) || !unrecorded.every(isEmpty)) {
      throw new PullError('upstream_malformed');
    }
    const recorded = since === null ? [] : days.filter((day) => day.date >= since);
    return {
      fetchedAt: new Date(answer.generatedAt).toISOString(),
      wholeOn: days.length === activityMaxDays ? last : null,
      since,
      repos: new Set(recorded.flatMap((day) => day.repos.map(({ repo }) => repo))),
      days: recorded.map(({ date, ...data }) => ({ day: date, data })),
    };
  },

  history: (pull) => ({
    fetchedAt: pull.fetchedAt,
    dates:
      pull.days.length === 0
        ? null
        : { from: pull.days[0]?.day ?? '', to: pull.days.at(-1)?.day ?? '' },
    merge: (stored) => merge(pull, stored),
  }),
};
