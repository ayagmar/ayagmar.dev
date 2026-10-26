// A TIL note shares the /til page with every other note (ADR 0028), so the ids its Markdown makes
// (heading slugs, footnotes) and the diagram ids would repeat there, and a `#fragment` link in
// one note would jump into another. The ids of a note carry its file name; a post's are left
// as they are, since a post is a page of its own.
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HastPluginEntry } from 'satteri';

/** `first-note-` for content/til/first-note.md; empty for anything else. */
export function idScope(fileURL: URL | undefined): string {
  if (fileURL === undefined) return '';
  const path = fileURLToPath(fileURL);
  return basename(dirname(path)) === 'til' ? `${basename(path, '.md')}-` : '';
}

/** What github-slugger, which Astro uses for headings, makes of a heading's text. */
const slugOf = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');

// Attributes that name another element by id.
const references = ['ariaDescribedBy', 'ariaLabelledBy', 'ariaControls', 'ariaOwns'] as const;
const headings = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

/**
 * Prefixes every id in a note, the `#fragment` links and the ARIA references to them, and gives
 * headings their slug under the prefix (Astro would add the bare slug after this runs, and
 * leaves an id that is already there). Must run before `diagrams`, which prefixes its own ids.
 */
export const scopeIds: HastPluginEntry = (factory) => {
  const scope = idScope(factory.fileURL);
  if (scope === '') return null;
  // github-slugger's rule: a repeated slug gets -1, -2, ... and every slug it emits is reserved,
  // so Example, Example, Example-1 give example, example-1, example-1-1 as Astro would.
  const used = new Map<string, number>();
  const unique = (base: string) => {
    let slug = base;
    while (used.has(slug)) {
      const next = (used.get(base) ?? 0) + 1;
      used.set(base, next);
      slug = `${base}-${next}`;
    }
    used.set(slug, 0);
    return slug;
  };
  return {
    name: 'min7-scope-ids',
    element: {
      filter: [],
      visit(node, ctx) {
        const props = node.properties;
        if (typeof props.id === 'string') {
          ctx.setProperty(node, 'id', scope + props.id);
        } else if (headings.includes(node.tagName)) {
          const slug = unique(slugOf(ctx.textContent(node)));
          ctx.setProperty(node, 'id', scope + slug);
        }
        if (typeof props.href === 'string' && props.href.length > 1 && props.href.startsWith('#')) {
          ctx.setProperty(node, 'href', `#${scope}${props.href.slice(1)}`);
        }
        for (const name of references) {
          const value = props[name];
          if (Array.isArray(value)) {
            ctx.setProperty(
              node,
              name,
              value.map((id) => scope + String(id))
            );
          }
        }
      },
    },
  };
};
