// Last.fm: now playing, recent scrobbles, top artists and weekly scrobble counts for min7_.
import {
  type ListeningSnapshot,
  lastfmArtistSchema,
  lastfmErrorSchema,
  lastfmRecentTracksSchema,
  lastfmTopArtistsSchema,
  lastfmTrackSchema,
  listeningSnapshotSchema,
} from '@min7/contracts';
import type { PullAdapter } from '../types.ts';
import {
  checkSnapshot,
  getJson,
  getOptionalJson,
  orNull,
  PullError,
  parseBody,
  type Schema,
  type UpstreamResponse,
} from './http.ts';
import { readSecret } from './secrets.ts';

export const lastfmEndpoint = 'https://ws.audioscrobbler.com/2.0/';
export const lastfmUser = 'min7_';
const listLimit = 10;
// Ten tracks with their image lists are about 10 KiB.
const maxBytes = 128 * 1024;

/** The four Last.fm answers a listening snapshot is built from; null is a failed request. */
export interface ListeningRaw {
  recentTracks: UpstreamResponse;
  topArtists: UpstreamResponse | null;
  thisWeek: UpstreamResponse | null;
  lastWeek: UpstreamResponse | null;
}

const day = 24 * 60 * 60;

/** Unix seconds of Monday 00:00 UTC of the week containing `now`. */
export function weekStart(now: Date): number {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000;
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  return midnight - daysSinceMonday * day;
}

export const listening: PullAdapter<ListeningRaw, ListeningSnapshot> = {
  id: 'listening',
  intervalSeconds: 60,

  async fetch(env, signal) {
    const apiKey = readSecret(env, 'LASTFM_API_KEY');
    if (apiKey === undefined) throw new PullError('not_configured');
    // Last.fm takes its parameters, the API key included, as a POST form too, which keeps
    // the key out of the request URL that Workers traces record.
    const call = (method: string, params: Record<string, string>) => ({
      signal,
      maxBytes,
      form: new URLSearchParams({
        method,
        user: lastfmUser,
        api_key: apiKey,
        format: 'json',
        ...params,
      }),
    });
    const thisMonday = weekStart(new Date());
    const lastMonday = thisMonday - 7 * day;
    // Only `@attr.total` of the weekly calls is read, so one item per page is enough.
    const [recentTracks, topArtists, thisWeek, lastWeek] = await Promise.all([
      getJson(lastfmEndpoint, call('user.getrecenttracks', { limit: String(listLimit) })),
      getOptionalJson(
        lastfmEndpoint,
        call('user.gettopartists', { period: 'overall', limit: String(listLimit) })
      ),
      getOptionalJson(
        lastfmEndpoint,
        call('user.getrecenttracks', { limit: '1', from: String(thisMonday) })
      ),
      getOptionalJson(
        lastfmEndpoint,
        call('user.getrecenttracks', {
          limit: '1',
          from: String(lastMonday),
          to: String(thisMonday),
        })
      ),
    ]);
    return { recentTracks, topArtists, thisWeek, lastWeek };
  },

  normalize(raw) {
    const recent = readLastfm(raw.recentTracks, lastfmRecentTracksSchema).recenttracks;
    const tracks = items(recent.track, lastfmTrackSchema);

    let nowPlaying: ListeningSnapshot['nowPlaying'] = null;
    const played: ListeningSnapshot['recent'] = [];
    for (const item of tracks) {
      const track = trackOf(item);
      if (track === null) continue;
      if (item['@attr']?.nowplaying === 'true') {
        nowPlaying ??= track;
      } else if (item.date !== undefined && played.length < listLimit) {
        played.push({ ...track, playedAt: fromUnixSeconds(Number(item.date.uts)) });
      }
    }

    const top = readOptional(raw.topArtists, lastfmTopArtistsSchema);
    const topArtists =
      top === null
        ? null
        : items(top.topartists.artist, lastfmArtistSchema).flatMap((artist) => {
            const name = artist.name.trim();
            return name === ''
              ? []
              : [{ artist: name, plays: Number(artist.playcount), url: lastfmUrl(artist.url) }];
          });

    return checkSnapshot(listeningSnapshotSchema, {
      nowPlaying,
      recent: played,
      topArtists: topArtists?.slice(0, listLimit) ?? null,
      scrobbles: { thisWeek: weekTotal(raw.thisWeek), lastWeek: weekTotal(raw.lastWeek) },
    });
  },
};

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

const readOptional = <T>(response: UpstreamResponse | null, schema: Schema<T>) =>
  response === null ? null : orNull(() => readLastfm(response, schema));

/** The items of a Last.fm list that match `schema`; one it cannot read is skipped. */
function items<T>(list: unknown[] | Record<string, unknown>, schema: Schema<T>): T[] {
  return (Array.isArray(list) ? list : [list]).flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

type LastfmTrack = ReturnType<typeof lastfmTrackSchema.parse>;

function trackOf(item: LastfmTrack) {
  const track = item.name.trim();
  const artist = item.artist['#text'].trim();
  if (track === '' || artist === '') return null;
  const album = item.album?.['#text'].trim() ?? '';
  return { track, artist, album: album === '' ? null : album, url: lastfmUrl(item.url) };
}

const lastfmPage = /^https:\/\/www\.last\.fm\/\S*$/;

const lastfmUrl = (url: string | undefined) =>
  url !== undefined && lastfmPage.test(url) ? url : null;

/** RFC 3339 in UTC without milliseconds, e.g. `2026-10-26T08:53:00Z`. */
const fromUnixSeconds = (seconds: number) =>
  new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

function weekTotal(response: UpstreamResponse | null): number | null {
  const parsed = readOptional(response, lastfmRecentTracksSchema);
  return parsed === null ? null : Number(parsed.recenttracks['@attr'].total);
}
