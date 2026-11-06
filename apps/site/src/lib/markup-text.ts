/**
 * Markup (src/lib/markup.ts) written out as text, for the copies that have no page around them:
 * /stats as text and the terminal room. A time reads as it does without JavaScript, in Rabat.
 */

import type { Element, Markup } from './markup.ts';
import { rabatStamp } from './words.ts';

const lineTags = new Set(['p', 'h3', 'caption', 'figcaption', 'tr', 'li']);

/** One element's words on one line; two elements side by side get a gap, as the page's columns do. */
export function inline(node: Markup): string {
  if (typeof node === 'string') return node;
  if (node.attrs['aria-hidden'] === 'true' || node.tag === 'summary') return '';
  if (node.attrs.role === 'img') return node.attrs['aria-label'] ?? '';
  if (node.tag === 'time' && 'data-ago' in node.attrs) return rabatStamp(node.attrs.datetime ?? '');
  return node.children.reduce<{ text: string; after: boolean }>(
    ({ text, after }, child) => {
      const part = inline(child);
      if (part === '') return { text, after };
      const element = typeof child !== 'string';
      return { text: text + (after && element ? '  ' : '') + part, after: element };
    },
    { text: '', after: false }
  ).text;
}

const isElement = (node: Markup): node is Element => typeof node !== 'string';

/** `markup` as lines of text, list items numbered and indented, `dt` and `dd` on one line. */
export function markupLines(nodes: readonly Markup[]): string[] {
  return nodes.filter(isElement).flatMap((node) => {
    if (node.attrs.role === 'img') return [`  ${inline(node)}`];
    if (node.tag === 'ol' || node.tag === 'ul') {
      const start = Number(node.attrs.start ?? 1);
      return node.children
        .filter(isElement)
        .map((item, index) =>
          node.tag === 'ol' ? `  ${start + index}. ${inline(item)}` : `  ${inline(item)}`
        );
    }
    const term = node.children.filter(isElement).find((child) => child.tag === 'dt');
    if (term !== undefined) {
      const definition = node.children.filter(isElement).find((child) => child.tag === 'dd');
      return [`  ${inline(term)}: ${definition === undefined ? '' : inline(definition)}`];
    }
    if (lineTags.has(node.tag)) {
      const line = inline(node).trim();
      return line === '' ? [] : [line];
    }
    return markupLines(node.children);
  });
}
