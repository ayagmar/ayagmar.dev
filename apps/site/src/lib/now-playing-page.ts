/**
 * The now-playing line in the page, for the home and /stats scripts: apart from `toNode`, so the
 * pages that only draw markup do not load the listening code.
 */
import { type NowPlayingLine, nowPlayingMarkup } from './listening.ts';
import { toNode } from './markup-page.ts';

// What the line's live region says now, so it is announced only when that changes.
let said = '';

/**
 * Updates the page's `.now-playing` line in place. The track sentence is a polite live region
 * announced whole when it changes; the time after it ticks every minute outside it.
 */
export function renderNowPlaying(line: HTMLElement, current: NowPlayingLine): void {
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
