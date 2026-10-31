// Monkeytype: the owner's personal bests in time and word-count tests (ADR 0033).
import {
  type MonkeytypePersonalBest,
  type MonkeytypeSnapshot,
  monkeytypeBestsSchema,
  monkeytypeBucketSchema,
  monkeytypeSnapshotSchema,
  type TypingBest,
} from '@min7/contracts';
import type { PullAdapter } from '../types.ts';
import { checkSnapshot, getJson, PullError, parseBody, type UpstreamResponse } from './http.ts';
import { readSecret } from './secrets.ts';

const endpoint = 'https://api.monkeytype.com/users/personalBests';
// One best per bucket and combination of settings is about 0.2 KiB; the owner's time answer
// was 0.7 KiB on 2026-10-26.
const maxBytes = 128 * 1024;

/** The two answers a snapshot is built from. `words` is null when `time` failed: not asked. */
export interface MonkeytypeRaw {
  time: UpstreamResponse;
  words: UpstreamResponse | null;
}

export const monkeytype: PullAdapter<MonkeytypeRaw, MonkeytypeSnapshot> = {
  id: 'monkeytype',
  // Hourly, two requests a pull: a new best shows within the hour, and 2 requests an hour sit
  // far inside the endpoint's 60 an hour and the account's 30 a minute (ADR 0033).
  intervalSeconds: 60 * 60,

  async fetch(env, signal) {
    const apeKey = readSecret(env, 'MONKEYTYPE_APE_KEY');
    // Optional: without a key nothing is asked and the last snapshot stays.
    if (apeKey === undefined) throw new PullError('not_configured');
    // The key goes in a header, to this host only: a redirect is never followed.
    const ask = (mode: 'time' | 'words') =>
      getJson(`${endpoint}?mode=${mode}`, {
        signal,
        maxBytes,
        headers: { authorization: `ApeKey ${apeKey}` },
        redirect: 'manual',
      });
    // One after the other, and no second request once the first is refused.
    const time = await ask('time');
    return { time, words: time.status === 200 ? await ask('words') : null };
  },

  normalize(raw) {
    const time = bestsIn(raw.time);
    if (raw.words === null) throw new PullError('upstream_error');
    const words = bestsIn(raw.words);
    return checkSnapshot(monkeytypeSnapshotSchema, {
      time: { 15: time('15'), 30: time('30'), 60: time('60'), 120: time('120') },
      words: { 10: words('10'), 25: words('25'), 50: words('50'), 100: words('100') },
    });
  },
};

/**
 * Monkeytype's ApeKey statuses: 470 invalid, 471 inactive, 472 malformed, and 479 for its
 * ApeKey rate limit, besides the usual 401, 403 and 429 (https://api.monkeytype.com/docs).
 */
const refusedKey = new Set([401, 403, 470, 471, 472]);

/** One mode's answer, read as the best at a test length, which is checked when asked for. */
function bestsIn(response: UpstreamResponse): (length: string) => TypingBest {
  if (refusedKey.has(response.status)) throw new PullError('upstream_unauthorized');
  if (response.status === 479) throw new PullError('upstream_rate_limited', response.retryAt);
  const { data } = parseBody(response, monkeytypeBestsSchema);
  return (length) => {
    const parsed = monkeytypeBucketSchema.safeParse(data?.[length] ?? []);
    if (!parsed.success) throw new PullError('upstream_malformed');
    return best(parsed.data);
  };
}

/** Off when absent, as Monkeytype's own matching reads it; only `true` turns it on. */
const off = (flag: boolean | undefined) => flag !== true;

/**
 * The best at the settings the page names: the English wordlist (not `english_1k` and the
 * like), normal difficulty, no punctuation, numbers or lazy mode. The highest WPM, then
 * accuracy, the most recent, raw and consistency break a tie; every number comes from that
 * one record. Null when no record has those settings.
 */
function best(records: readonly MonkeytypePersonalBest[]): TypingBest {
  let top: MonkeytypePersonalBest | undefined;
  for (const record of records) {
    const { language, difficulty, punctuation, numbers, lazyMode } = record;
    if (language !== 'english' || difficulty !== 'normal') continue;
    if (!(off(punctuation) && off(numbers) && off(lazyMode))) continue;
    if (top === undefined || ahead(record, top)) top = record;
  }
  if (top === undefined) return null;
  const { wpm, acc, raw, consistency, timestamp } = top;
  // The UTC day it was set; the exact time is not published (ADR 0033).
  return { wpm, acc, raw, consistency, date: new Date(timestamp).toISOString().slice(0, 10) };
}

const order = ['wpm', 'acc', 'timestamp', 'raw', 'consistency'] as const;

function ahead(a: MonkeytypePersonalBest, b: MonkeytypePersonalBest): boolean {
  for (const key of order) if (a[key] !== b[key]) return a[key] > b[key];
  return false;
}
