/**
 * Listening on the home page and /stats (ADR 0015): which `/v1/listening` data the browser may
 * show, and the now-playing line both pages render, at build time (NowPlaying.astro) and live.
 */
import type { ListeningSnapshot } from '@min7/contracts';
import { type Answer, instantMs, list, stamp, text, whole } from './live.ts';

/** A Last.fm page, or null. Links only; the site never loads from Last.fm. */
const lastfm = (value: unknown) =>
  value === null || (text(value, 2048) && /^https:\/\/www\.last\.fm\/\S*$/.test(value));

const track = (value: unknown) => {
  const { track, artist, album, url } = Object(value);
  return text(track) && text(artist) && (album === null || text(album)) && lastfm(url);
};

/** `data` if it is a listening snapshot as the contract states it, else undefined. */
export function readListening(data: unknown): ListeningSnapshot | undefined {
  const { nowPlaying, recent, topArtists, scrobbles } = Object(data);
  const { thisWeek, lastWeek } = Object(scrobbles);
  return (nowPlaying === null || track(nowPlaying)) &&
    list(
      recent,
      10,
      (item) => track(item) && instantMs(Object(item).playedAt, true) !== undefined
    ) &&
    (topArtists === null ||
      list(topArtists, 10, (item) => {
        const { artist, plays, url } = Object(item);
        return text(artist) && whole(plays) && lastfm(url);
      })) &&
    (thisWeek === null || whole(thisWeek)) &&
    (lastWeek === null || whole(lastWeek))
    ? (data as ListeningSnapshot)
    : undefined;
}

/** What the now-playing line says. */
export interface NowPlayingLine {
  /** `Now playing`, `Last played` or, with no track, the whole sentence. */
  lead: string;
  /** Last.fm says it is playing, in an answer that still describes now. */
  playing: boolean;
  track: { track: string; artist: string; url: string | null } | null;
  /** When the track was last seen playing; null while it plays. */
  at: string | null;
}

/**
 * The now-playing line for a snapshot fetched at `fetchedAt`: `Now playing` only while
 * Last.fm says so and the snapshot still describes `now` (fresh, and the latest request
 * brought it: src/lib/live.ts); otherwise the track it last saw playing, or the last scrobble,
 * with when. The build cannot know, so it always says `Last played`.
 */
export function nowPlaying(
  { nowPlaying: current, recent }: ListeningSnapshot,
  fetchedAt: string,
  now: boolean
): NowPlayingLine {
  if (current !== null && now) {
    return { lead: 'Now playing', playing: true, track: current, at: null };
  }
  const last = current === null ? recent[0] : { ...current, playedAt: fetchedAt };
  return last === undefined
    ? {
        lead: now ? 'Nothing playing right now' : 'Nothing played lately',
        playing: false,
        track: null,
        at: null,
      }
    : { lead: 'Last played', playing: false, track: last, at: last.playedAt };
}

// What the line's live region says now, so it is announced only when that changes.
let said = '';

/**
 * Updates the page's `.now-playing` line in place. The track sentence is a polite live region
 * announced whole when it changes; the time after it ticks every minute outside it.
 */
export function renderNowPlaying(
  line: HTMLElement,
  { data, fetchedAt }: Answer<ListeningSnapshot>,
  now: boolean
): void {
  const { lead, playing, track, at } = nowPlaying(data, fetchedAt, now);
  const words = line.firstElementChild as HTMLElement;
  const key = JSON.stringify([lead, track]);
  if (key !== said) {
    said = key;
    if (track === null) {
      words.replaceChildren(lead);
    } else {
      // Text only: titles and artists are Last.fm's, so never markup.
      const cite = document.createElement('cite');
      cite.textContent = track.track;
      let title: Node = cite;
      if (track.url !== null) {
        title = document.createElement('a');
        (title as HTMLAnchorElement).href = track.url;
        title.appendChild(cite);
      }
      words.replaceChildren(`${lead} `, title, ` by ${track.artist}`);
    }
  }
  line.toggleAttribute('data-playing', playing);
  line.replaceChildren(words, ...(at === null ? [] : [', ', stamp(at)]));
}
