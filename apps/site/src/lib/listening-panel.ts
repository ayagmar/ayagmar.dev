/**
 * The body of /stats's listening panel, under the now-playing line: the week's scrobbles, the
 * recent tracks and the top artists, each track and artist a link to its Last.fm page. The
 * build renders it (src/pages/stats.astro) and so does a live answer (src/scripts/stats-live.ts).
 */
import type { ListeningSnapshot } from '@min7/contracts';
import { count } from '../data/format.ts';
import { artistUrl } from './lastfm.ts';
import { trackBy } from './listening.ts';
import { el, type Markup, when } from './markup.ts';
import { weekCount, statsWords as words } from './stats.ts';

export function listeningBody({ scrobbles, recent, topArtists }: ListeningSnapshot): Markup[] {
  return [
    el(
      'dl',
      {},
      el('dt', {}, words.thisWeek),
      el('dd', {}, weekCount(scrobbles.thisWeek)),
      el('dt', {}, words.lastWeek),
      el('dd', {}, weekCount(scrobbles.lastWeek))
    ),
    el('h3', {}, words.recent),
    recent.length === 0
      ? el('p', {}, words.noRecent)
      : el(
          'ol',
          {},
          ...recent.map((item) =>
            el('li', {}, ...trackBy(item.track, item.artist, item.url), ' ', when(item.playedAt))
          )
        ),
    el('h3', {}, words.top),
    topArtists === null || topArtists.length === 0
      ? el('p', {}, words.noTop)
      : el(
          'ol',
          {},
          ...topArtists.map(({ artist, plays, url }) =>
            el(
              'li',
              {},
              el('a', { href: url ?? artistUrl(artist) }, artist),
              `, ${count(plays)} plays`
            )
          )
        ),
  ];
}
