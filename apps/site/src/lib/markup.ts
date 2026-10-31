/**
 * Markup for what /stats draws both at build time and in the browser, written once: a panel
 * builds it from a snapshot, `Markup.astro` renders it into the page's HTML, and `toNode`
 * renders it into the DOM when a live answer replaces the build's, so the two cannot drift.
 * Strings are text and attribute values are values: neither is ever parsed as markup.
 */
export interface Element {
  tag: string;
  attrs: Record<string, string>;
  children: Markup[];
}
export type Markup = string | Element;

export const el = (tag: string, attrs: Record<string, string>, ...children: Markup[]): Element => ({
  tag,
  attrs,
  children,
});

/**
 * A time the page reads relative to now. `Markup.astro` writes it as `Stamp.astro` does, the
 * time in Rabat; `tick` (src/lib/live.ts) fills it in the browser, as it rewrites the build's.
 */
const stampMarkup = (iso: string) => el('time', { datetime: iso, 'data-ago': '' });

/**
 * `· 3 hours ago`, or with `words` `· checked 3 hours ago`: a time after the words it dates.
 * The dot and the time wrap together (base.css), so a line never ends on the dot with the time
 * alone under it.
 */
export const when = (iso: string, words = '') =>
  el('span', { class: 'when' }, `· ${words}`, stampMarkup(iso));

/** `markup` as a DOM node. */
export function toNode(markup: Markup): Node {
  if (typeof markup === 'string') return document.createTextNode(markup);
  const element = document.createElement(markup.tag);
  for (const [name, value] of Object.entries(markup.attrs)) element.setAttribute(name, value);
  element.append(...markup.children.map(toNode));
  return element;
}
