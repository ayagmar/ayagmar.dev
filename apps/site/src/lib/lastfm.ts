/**
 * Links to Last.fm pages built from names, for the tracks and artists signals gives no link
 * for. Links only; the site never loads from Last.fm.
 */

/**
 * `name` as Last.fm writes it in a page's path, as its own links did on 2026-10-31: a space is
 * `+`, so a `+` is `%2B` encoded again (`%252B`); `&`, `(` and `)` stay as they are; `'` is
 * `%27`; anything else outside letters, digits and `-_.!~*` is percent-encoded UTF-8 (`/` is
 * `%2F`, `?` `%3F`, `#` `%23`, `ó` `%C3%B3`).
 */
const pathName = (name: string) =>
  encodeURIComponent(name)
    .replaceAll('%20', '+')
    .replaceAll('%2B', '%252B')
    .replaceAll('%26', '&')
    .replaceAll("'", '%27');

/** `https://www.last.fm/music/Simon+&+Garfunkel`. */
export const artistUrl = (artist: string) => `https://www.last.fm/music/${pathName(artist)}`;

/** `https://www.last.fm/music/Weezer/_/Why+Bother%3F`. */
export const trackUrl = (artist: string, track: string) =>
  `${artistUrl(artist)}/_/${pathName(track)}`;
