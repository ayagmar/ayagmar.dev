// Listening per day in Rabat (ADR 0038): how many scrobbles a date's range holds and its newest
// dated one, read from Last.fm's range total, never from the snapshot's ten recent tracks.
import {
  type ListeningSnapshot,
  type ListeningStoredDay,
  listeningStoredDaySchema,
} from '@min7/contracts';
import { nextDate, rabatDate, rabatDayStart } from '@min7/contracts/rabat';
import { logEvent } from '../../security/log.ts';
import { type DayValue, mergedRows } from '../../storage/daily.ts';
import type { PullHistory } from '../types.ts';
import {
  checkSnapshot,
  fromUnixSeconds,
  getOptionalJson,
  orNull,
  type UpstreamResponse,
} from './http.ts';
import { lastfmEndpoint, lastfmUser, readRangePage } from './lastfm.ts';

/** One item is enough: `total` is the count and the newest comes first. */
const rangeLimit = 1;
/** One scrobble and the track playing now are about 2 KiB. */
const rangeMaxBytes = 16 * 1024;

/**
 * Dates are read in the first minutes of each hour. Listening runs at most 5 minutes apart
 * (`test/cron.test.ts`), so every hour has a pull inside the window, and a failure waits for
 * the next hour rather than asking again every minute.
 */
const windowMinutes = 5;

/** A date's answer: null is a request that failed. */
export interface DayRead {
  date: string;
  /** Unix ms just before asking, so a read that crossed midnight counts as open. */
  at: number;
  response: UpstreamResponse | null;
}

const rangeOf = (date: string) => ({
  from: rabatDayStart(date),
  to: rabatDayStart(nextDate(date)),
});

/**
 * The dates to read at `now`: today, and yesterday for scrobbles that arrive late, for the 24
 * hours after it ends. None outside the window, so most pulls cost what they always did.
 */
export function dayReadsDue(now: number): string[] {
  if (new Date(now).getUTCMinutes() >= windowMinutes) return [];
  const today = rabatDate(now);
  return [rabatDate((rabatDayStart(today) - 1) * 1000), today];
}

/** Asks Last.fm for `date`. The key goes in the POST form, out of URLs that traces record. */
export async function readListeningDay(
  date: string,
  apiKey: string,
  signal: AbortSignal
): Promise<DayRead> {
  const { from, to } = rangeOf(date);
  const at = Date.now();
  const response = await getOptionalJson(lastfmEndpoint, {
    signal,
    maxBytes: rangeMaxBytes,
    form: new URLSearchParams({
      method: 'user.getrecenttracks',
      user: lastfmUser,
      api_key: apiKey,
      format: 'json',
      limit: String(rangeLimit),
      from: String(from),
      to: String(to),
    }),
  });
  return { date, at, response };
}

/**
 * What an answer says of its date. A checked empty range is `{ count: 0, last: null }`: a
 * recorded zero. Anything unreadable throws a `PullError`, and nothing is written for it.
 */
function listeningDayOf({ date, at, response }: DayRead & { response: UpstreamResponse }) {
  const { total, scrobbles } = readRangePage(rangeOf(date), response, rangeLimit);
  const [newest] = scrobbles;
  return checkSnapshot(listeningStoredDaySchema, {
    count: total,
    last:
      newest === undefined
        ? null
        : {
            track: newest.track,
            artist: newest.artist,
            playedAt: fromUnixSeconds(newest.at),
          },
    asOf: new Date(at).toISOString(),
  });
}

/** The newer of two last tracks; a correction at the same instant comes from the newer read. */
function laterTrack(stored: ListeningStoredDay, incoming: ListeningStoredDay) {
  if (stored.last === null) return incoming.last;
  if (incoming.last === null) return stored.last;
  const order = Date.parse(incoming.last.playedAt) - Date.parse(stored.last.playedAt);
  if (order !== 0) return order > 0 ? incoming.last : stored.last;
  return Date.parse(incoming.asOf) > Date.parse(stored.asOf) ? incoming.last : stored.last;
}

/**
 * A stored day and a new read of its date (ADR 0038): the count never goes down, the last
 * track is ordered by when it was played and never by when it was read, and `asOf` moves on
 * while the day is open. Once a read after the date's end is stored, one that adds nothing
 * leaves the row as it is.
 */
export function mergeListeningDay(
  date: string,
  stored: ListeningStoredDay,
  incoming: ListeningStoredDay
): ListeningStoredDay {
  const count = Math.max(stored.count, incoming.count);
  const last = laterTrack(stored, incoming);
  const closed = Date.parse(stored.asOf) >= rabatDayStart(nextDate(date)) * 1000;
  if (closed && count === stored.count && JSON.stringify(last) === JSON.stringify(stored.last)) {
    return stored;
  }
  const asOf = new Date(Math.max(Date.parse(incoming.asOf), Date.parse(stored.asOf))).toISOString();
  return { count, last, asOf };
}

/** The readable answers of `reads`; each one that failed is logged and writes nothing. */
export function listeningDayValues(reads: readonly DayRead[]): DayValue<ListeningStoredDay>[] {
  return reads.flatMap((read) => {
    const { response } = read;
    const value = response === null ? null : orNull(() => listeningDayOf({ ...read, response }));
    if (value === null) {
      logEvent('warn', 'day read failed', { source: 'listening', date: read.date });
      return [];
    }
    return [{ date: read.date, value }];
  });
}

/**
 * What a listening pull stores besides its snapshot, or undefined with no day read: then the
 * pull is the plain `put` it always was. The day's failure never costs the snapshot.
 */
export function listeningDaysHistory(
  snapshot: ListeningSnapshot,
  reads: readonly DayRead[]
): PullHistory | undefined {
  const values = listeningDayValues(reads);
  const [first] = values;
  const last = values.at(-1);
  if (first === undefined || last === undefined) return undefined;
  return {
    fetchedAt: new Date().toISOString(),
    dates: { from: first.date, to: last.date },
    merge: (stored) => ({
      snapshot,
      days: mergedRows(values, stored.days, listeningStoredDaySchema, mergeListeningDay),
    }),
  };
}
