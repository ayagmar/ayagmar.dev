/** Markup (src/lib/markup.ts) in the page: browser only, as the site Worker imports the rest. */
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
