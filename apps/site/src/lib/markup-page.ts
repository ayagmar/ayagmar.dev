/** Markup (src/lib/markup.ts) in the page: browser only, as the site Worker imports the rest. */
import { type NowPlayingLine, nowPlayingMarkup } from './listening.ts';
import type { Markup } from './markup.ts';

// An SVG element must be created in its namespace, or the browser draws nothing.
const svg = new Set(['svg', 'rect']);

/** `markup` as a DOM node. */
export function toNode(markup: Markup): Node {
  if (typeof markup === 'string') return document.createTextNode(markup);
  const element = svg.has(markup.tag)
    ? document.createElementNS('http://www.w3.org/2000/svg', markup.tag)
    : document.createElement(markup.tag);
  for (const [name, value] of Object.entries(markup.attrs)) element.setAttribute(name, value);
  for (const child of markup.children) element.appendChild(toNode(child));
  return element;
}

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
