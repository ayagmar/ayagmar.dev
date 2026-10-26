import { describe, expect, it } from 'vitest';
import { type Note, noteSummary } from '../src/lib/til.ts';
import { tilSchema } from '../src/lib/til-schema.ts';

const note = (body: string): Note => ({
  id: 'a-note',
  data: { title: 'A note', date: new Date('2026-10-18'), tags: [], draft: false },
  body,
});

describe('note summaries', () => {
  // Catches Markdown syntax leaking into a feed's plain-text description.
  it('are the first paragraph as plain text', () => {
    expect(
      noteSummary(note('Use `sh -s` with a [pipe](https://example.com) and **care**.\n\nSecond.'))
    ).toBe('Use sh -s with a pipe and care.');
  });

  // Catches a code block, a heading or a list becoming the description.
  it('skip code, headings and lists before the first paragraph', () => {
    expect(noteSummary(note('```sh\nls -l\n```\n\n## Why\n\n- one\n\nThe reason.'))).toBe(
      'The reason.'
    );
  });

  it('fall back to the title for a note that is only code, and cut a long paragraph at a word', () => {
    expect(noteSummary(note('```sh\nls\n```'))).toBe('A note');
    const long = noteSummary(note('word '.repeat(100)));
    expect(long.length).toBeLessThanOrEqual(201);
    expect(long.endsWith('word…')).toBe(true);
  });
});

describe('TIL frontmatter', () => {
  const valid = { title: 'A note', date: new Date('2026-10-18') };

  // Catches a post field such as `summary` being accepted silently on a note, and a tag that the
  // posts' vocabulary would refuse.
  it.each([
    ['an unknown field', { summary: 'no' }],
    ['an uppercase tag', { tags: ['Shell'] }],
    ['a repeated tag', { tags: ['shell', 'shell'] }],
    ['an empty title', { title: ' ' }],
  ])('rejects %s', (_case, extra) => {
    expect(tilSchema.safeParse({ ...valid, ...extra }).success).toBe(false);
  });

  it('defaults tags to none and draft to false', () => {
    expect(tilSchema.parse(valid)).toMatchObject({ tags: [], draft: false });
  });
});
