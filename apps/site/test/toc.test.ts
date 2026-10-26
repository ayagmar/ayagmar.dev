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

  // Catches a TIL note with two sections and a footnote getting a contents list: the note's ids
  // carry its file name (ADR 0028), so its footnotes heading is `a-note-footnote-label`.
  it('ignores the footnotes heading of a note, whose ids are scoped', () => {
    const note = [
      heading(2, 'a-note-one'),
      heading(2, 'a-note-two'),
      heading(2, 'a-note-footnote-label'),
    ];
    expect(contents(note, 'a-note-')).toEqual([]);
  });

  // Catches an authored section whose title ends in "footnote-label" vanishing from the list,
  // or taking a three-section post's contents with it.
  it('keeps an authored heading that only looks like the footnotes heading', () => {
    const post = [
      heading(2, 'first'),
      heading(2, 'understanding-footnote-label'),
      heading(2, 'last'),
    ];
    expect(contents(post).map((item) => item.slug)).toEqual([
      'first',
      'understanding-footnote-label',
      'last',
    ]);
    const note = [
      heading(2, 'a-note-first'),
      heading(2, 'a-note-footnote-label'),
      heading(2, 'a-note-last'),
    ];
    expect(contents(note, 'a-note-').map((item) => item.slug)).toEqual([]);
  });
});
