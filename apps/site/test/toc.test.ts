import type { MarkdownHeading } from 'astro';
import { describe, expect, it } from 'vitest';
import { contents } from '../src/lib/toc.ts';

const heading = (depth: number, slug: string): MarkdownHeading => ({ depth, slug, text: slug });

describe('a post table of contents', () => {
  // Catches a contents list on a short post, or the footnotes' hidden heading showing up in it.
  it('lists sections and subsections of a long post, and nothing for a short one', () => {
    const long = [
      heading(2, 'one'),
      heading(3, 'one-a'),
      heading(4, 'deep'),
      heading(2, 'two'),
      heading(2, 'footnote-label'),
    ];
    expect(contents(long).map((item) => item.slug)).toEqual(['one', 'one-a', 'two']);
    expect(contents([heading(2, 'one'), heading(2, 'two')])).toEqual([]);
  });
});
