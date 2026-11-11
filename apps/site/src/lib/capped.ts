import { el, type Markup } from './markup.ts';

/**
 * The first `keep` items of a list, then the rest in a disclosure that opens without
 * JavaScript, so a long panel stays short on a phone and nothing is out of reach.
 */
export function capped(
  tag: 'ul' | 'ol',
  attrs: Record<string, string>,
  items: Markup[],
  keep: number,
  more: (rest: number) => string
): Markup[] {
  const shown = el(tag, attrs, ...items.slice(0, keep));
  if (items.length <= keep) return [shown];
  const rest = el(
    tag,
    tag === 'ol' ? { ...attrs, start: String(keep + 1) } : attrs,
    ...items.slice(keep)
  );
  return [
    shown,
    el('details', { class: 'more' }, el('summary', {}, more(items.length - keep)), rest),
  ];
}
