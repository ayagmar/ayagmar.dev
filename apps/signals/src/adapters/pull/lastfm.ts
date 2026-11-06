// Last.fm reads shared by the adapters that ask it: the wire's error bodies, and one page of a
// range of scrobbles.
import { lastfmErrorSchema, lastfmHistoryPageSchema } from '@min7/contracts';
import { PullError, parseBody, type Schema, type UpstreamResponse } from './http.ts';

export const lastfmEndpoint = 'https://ws.audioscrobbler.com/2.0/';
export const lastfmUser = 'min7_';

/** A Last.fm answer checked against `schema`. Last.fm reports errors in the body, sometimes with HTTP 200. */
export function readLastfm<T>(response: UpstreamResponse, schema: Schema<T>): T {
  const failure = lastfmErrorSchema.safeParse(response.body);
  if (failure.success) {
    if (failure.data.error === 6) throw new PullError('upstream_not_found'); // no such user
    if (failure.data.error === 29) throw new PullError('upstream_rate_limited', response.retryAt);
    throw new PullError('upstream_error');
  }
  return parseBody(response, schema);
}

/** A day's bounds in Unix seconds: `from` inclusive, `to` exclusive, as Last.fm's are (ADR 0030). */
export interface DayRange {
  from: number;
  to: number;
}

export interface Scrobble {
  /** Unix seconds. */
  at: number;
  artist: string;
  track: string;
}

/**
 * The first page of a range's scrobbles, with `limit` per page. It must be page 1 of min7_'s
 * and hold exactly the scrobbles its total says page 1 holds, each inside the range and newest
 * first; anything else fails, since skipping a scrobble would change the counts. The track
 * playing now is left out.
 */
export function readRangePage(
  range: DayRange,
  response: UpstreamResponse,
  limit: number
): { total: number; scrobbles: Scrobble[] } {
  const fail = () => new PullError('upstream_malformed');
  const page = readLastfm(response, lastfmHistoryPageSchema).recenttracks;
  const attr = page['@attr'];
  const total = Number(attr.total);
  if (
    attr.user.toLowerCase() !== lastfmUser ||
    attr.page !== '1' ||
    Number(attr.perPage) !== limit ||
    Number(attr.totalPages) !== Math.ceil(total / limit)
  ) {
    throw fail();
  }
  const items = (Array.isArray(page.track) ? page.track : [page.track]).filter(
    (item) => item['@attr']?.nowplaying !== 'true'
  );
  if (items.length !== Math.min(total, limit)) throw fail();
  let previous = Number.POSITIVE_INFINITY;
  const scrobbles = items.map((item) => {
    const at = Number(item.date?.uts);
    const artist = item.artist['#text'].trim();
    const track = item.name.trim();
    if (!(at >= range.from && at < range.to && at <= previous) || artist === '' || track === '') {
      throw fail();
    }
    previous = at;
    return { at, artist, track };
  });
  return { total, scrobbles };
}
