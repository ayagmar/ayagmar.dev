import type { MarkdownHeading } from 'astro';

/** A post with fewer headings than this has no table of contents. */
const fewest = 3;

/**
 * The headings a post's table of contents lists: its sections (h2) and their subsections (h3),
 * without the footnotes' own screen-reader heading. That heading's id is `footnote-label`, behind
 * the `scope` prefix a note's ids carry (ADR 0028, `a-note-`). Empty for a short post, which needs
 * no contents.
 */
export function contents(headings: MarkdownHeading[], scope = ''): MarkdownHeading[] {
  const listed = headings.filter(
    (heading) =>
      (heading.depth === 2 || heading.depth === 3) && heading.slug !== `${scope}footnote-label`
  );
  return listed.length >= fewest ? listed : [];
}
