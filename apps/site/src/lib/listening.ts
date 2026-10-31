/**
 * Listening on the home page and /stats (ADR 0015): which `/v1/listening` data the browser may
 * show, and the now-playing line both pages render, at build time (NowPlaying.astro) and live.
 */
import type { ListeningSnapshot } from '@min7/contracts';
import { artistUrl, trackUrl } from './lastfm.ts';
import { type Answer, instantMs, list, text, whole } from './live.ts';
import { el, type Markup, toNode, when } from './markup.ts';

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
  /**
   * When the track was last seen playing or, with no track, when Last.fm was last asked; null
   * while the line describes now.
   */
  at: string | null;
  /** The words between the dot and `at`: `checked ` for an empty answer. */
  when: string;
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
    return { lead: 'Now playing', playing: true, track: current, at: null, when: '' };
  }
  const last = current === null ? recent[0] : { ...current, playedAt: fetchedAt };
  return last === undefined
    ? {
        lead: now ? 'Nothing playing right now' : 'Nothing played lately',
        playing: false,
        track: null,
        // An empty answer that no longer describes now is dated like any other.
        at: now ? null : fetchedAt,
        when: 'checked ',
      }
    : { lead: 'Last played', playing: false, track: last, at: last.playedAt, when: '' };
}

/**
 * `<a><cite>Title</cite></a> by <a>Artist</a>`, each a link to its Last.fm page. A link from
 * signals is used as it is, the reader having checked it is on Last.fm; otherwise one is built
 * from the names.
 */
export const trackBy = (track: string, artist: string, url: string | null): Markup[] => [
  el('a', { href: url ?? trackUrl(artist, track) }, el('cite', {}, track)),
  ' by ',
  el('a', { href: artistUrl(artist) }, artist),
];

/**
 * The now-playing line as markup, at build time (NowPlaying.astro) and live: the sentence,
 * announced whole when it changes, and the time after it, which ticks outside it.
 */
export function nowPlayingMarkup(line: NowPlayingLine): { words: Markup[]; at: Markup | null } {
  const { lead, track, at } = line;
  return {
    words: track === null ? [lead] : [`${lead} `, ...trackBy(track.track, track.artist, track.url)],
    at: at === null ? null : when(at, line.when),
  };
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
  const current = nowPlaying(data, fetchedAt, now);
  const { words, at } = nowPlayingMarkup(current);
  const sentence = line.firstElementChild as HTMLElement;
  const key = JSON.stringify(words);
  if (key !== said) {
    said = key;
    // Text only: titles and artists are Last.fm's, so never markup.
    sentence.replaceChildren(...words.map(toNode));
  }
  line.toggleAttribute('data-playing', current.playing);
  line.replaceChildren(sentence, ...(at === null ? [] : [' ', toNode(at)]));
}
