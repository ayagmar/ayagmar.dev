// A `#` link on each section and subsection heading (h2, h3) that points at the heading itself,
// so a reader can follow it and copy the address. The link holds no text: CSS draws the `#` and
// `aria-label` names it, so the heading's text, which Astro reads for the table of contents and
// Pagefind indexes, stays the same. Needs the ids `scopeIds` gives headings. The footnotes'
// heading is for screen readers only and gets none.
import type { HastPluginEntry } from 'satteri';

export const headingLinks: HastPluginEntry = () => ({
  name: 'min7-heading-links',
  element: {
    filter: ['h2', 'h3'],
    visit(heading, ctx) {
      const { id } = heading.properties;
      if (typeof id !== 'string' || id.endsWith('footnote-label')) return;
      ctx.appendChild(heading, {
        type: 'element',
        tagName: 'a',
        properties: {
          href: `#${id}`,
          className: ['heading-link'],
          ariaLabel: 'Link to this section',
          dataPagefindIgnore: true,
        },
        children: [],
      });
    },
  },
});
