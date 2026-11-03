import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import SeriesLine from '../src/components/SeriesLine.astro';
import { type Post, publishedEntries, seriesParts } from '../src/lib/writing.ts';
import { writingSchema } from '../src/lib/writing-schema.ts';

const post = (id: string, date: string, extra: Record<string, unknown> = {}): Post => ({
  id,
  data: writingSchema.parse({ title: `Title ${id}`, date, summary: 'One.', ...extra }),
});

const posts = [
  post('three', '2026-10-20', { series: 'runners' }),
  post('one', '2026-10-01', { series: 'runners' }),
  post('draft', '2026-10-25', { series: 'runners', draft: true }),
  post('two', '2026-10-10', { series: 'runners' }),
  post('alone', '2026-10-05', { series: 'solo' }),
  post('loner-draft', '2026-10-06', { series: 'half', draft: true }),
  post('half', '2026-10-07', { series: 'half' }),
  post('plain', '2026-10-08'),
];
const ids = (parts: Post[]) => parts.map((part) => part.id);

describe('a series', () => {
  // Catches a draft part leaking into production, parts out of date order, and "Part 1 of 1".
  it('lists the parts the build shows, oldest first, and nothing for a series of one', () => {
    const production = publishedEntries(posts, false);
    const at = (id: string, shown: Post[]) =>
      ids(seriesParts(shown, shown.find((p) => p.id === id) as Post));
    expect(at('two', production)).toEqual(['one', 'two', 'three']);
    expect(at('half', production)).toEqual([]);
    expect(at('alone', production)).toEqual([]);
    expect(at('plain', production)).toEqual([]);

    const previews = publishedEntries(posts, true);
    expect(at('two', previews)).toEqual(['one', 'two', 'three', 'draft']);
    expect(at('half', previews)).toEqual(['loner-draft', 'half']);
  });

  // Catches the current part linked to itself or unmarked, and a wrong count.
  it('says which part this is and links only the others', async () => {
    const parts = seriesParts(posts, posts[3] as Post);
    const container = await AstroContainer.create();
    const html = await container.renderToString(SeriesLine, { props: { current: 'two', parts } });
    expect(html).toContain('<p>Part 2 of 4</p>');
    expect(html).toContain('<span aria-current="page">Title two</span>');
    expect([...html.matchAll(/<a href="([^"]+)">/g)].map(([, href]) => href)).toEqual([
      '/writing/one',
      '/writing/three',
      '/writing/draft',
    ]);
  });
});
