// repo-pulse daily activity (ADR 0038): public activity per UTC day, kept as daily history.
import {
  activityMaxDays,
  activityMaxRepos,
  type RepoPulseActivityDay,
  repoFullNamePattern,
  repoPulseActivityReaderSchema,
  type ShippingActivitySnapshot,
  type ShippingActivityStoredDay,
  shippingActivitySnapshotSchema,
} from '@min7/contracts';
import { rabatDate, rabatDayStart } from '@min7/contracts/rabat';
import type { HistoryAdapter } from '../types.ts';
import { checkSnapshot, getJson, PullError, parseBody, type UpstreamResponse } from './http.ts';

const activityUrl = `https://repo-pulse.ayagmar.workers.dev/public/activity?days=${activityMaxDays}`;
// 400 days with a handful of repositories each is about 100 KiB; 50 on every day would be more,
// and is not a day this account has.
const maxBytes = 512 * 1024;

/** A normalized activity answer: what is stored as the snapshot, and the recorded days. */
export interface ShippingActivityPull {
  /** repo-pulse's `generatedAt`, as UTC with milliseconds. */
  fetchedAt: string;
  snapshot: ShippingActivitySnapshot;
  /** The days from `since` on, oldest first. */
  days: { day: string; data: ShippingActivityStoredDay }[];
}

const dayMs = 24 * 60 * 60 * 1000;
const intervalMs = 60 * 60 * 1000;
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
 * Whether `days` are the window signals asked for: exactly 400, one per date, oldest first,
 * ending with the UTC date of `generatedAt`; each day's repositories sorted and named once,
 * and the day's counts their sums (or more, when the list was cut at 50).
 */
function isWholeWindow(generatedAt: string, days: readonly RepoPulseActivityDay[]): boolean {
  if (days.length !== activityMaxDays) return false;
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

export const shippingActivity: HistoryAdapter<UpstreamResponse, ShippingActivityPull> = {
  id: 'shipping-activity',
  intervalSeconds: intervalMs / 1000,

  dueAt(status) {
    const due = (status.lastAttemptAt ?? 0) + intervalMs;
    return Math.max(due, rabatDayStart(rabatDate(due)) * 1000 + midnightYieldMs);
  },

  fetch: (_env, signal) => getJson(activityUrl, { signal, maxBytes }),

  /**
   * The answer is all or nothing: these days are kept for good, so one that is not the whole
   * window, or that repo-pulse marks incomplete, is refused rather than partly stored. Days
   * before `since` are not recorded, so they are left out, never stored as zeros.
   */
  normalize(raw) {
    const answer = parseBody(raw, repoPulseActivityReaderSchema);
    if (!answer.complete) throw new PullError('upstream_incomplete');
    const days = answer.days.map(readActivityDay).filter((day) => day !== null);
    if (days.length !== answer.days.length || !isWholeWindow(answer.generatedAt, days)) {
      throw new PullError('upstream_malformed');
    }
    const { since } = answer;
    const recorded = since === null ? [] : days.filter((day) => day.date >= since);
    const repos = [...new Set(days.flatMap((day) => day.repos.map(({ repo }) => repo)))];
    return {
      fetchedAt: new Date(answer.generatedAt).toISOString(),
      snapshot: checkSnapshot(shippingActivitySnapshotSchema, { since, repos: repos.sort() }),
      days: recorded.map(({ date, ...data }) => ({ day: date, data })),
    };
  },

  history: (pull) => pull,
};
