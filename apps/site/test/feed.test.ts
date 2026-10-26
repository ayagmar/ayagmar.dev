import { describe, expect, it } from 'vitest';
import { buildFeed, feedPaths, renderAtom, renderRss } from '../src/lib/feed.ts';
import type { Post } from '../src/lib/writing.ts';
import { publishedPosts } from '../src/lib/writing.ts';

const post = (id: string, data: Partial<Post['data']> = {}): Post => ({
  id,
  data: {
    title: `Title ${id}`,
    date: new Date('2026-10-01T00:00:00Z'),
    summary: `Summary ${id}`,
    tags: [],
    draft: false,
    ...data,
  },
});

const corpus = [
  post('escaping', {
    title: 'Tom & Jerry <script>alert(1)</script>',
    summary: 'Uses <b>HTML</b> & "quotes" in the summary\u0007.',
    date: new Date('2026-10-20T00:00:00Z'),
    updated: new Date('2026-10-22T00:00:00Z'),
    tags: ['rust', 'ci'],
  }),
  post('older', { tags: ['rust'] }),
  post('secret-draft', { draft: true, tags: ['rust'], date: new Date('2026-10-25T00:00:00Z') }),
];
const published = publishedPosts(corpus, false);

describe('feeds', () => {
  const rss = renderRss(buildFeed(published));
  const atom = renderAtom(buildFeed(published));

  it('escape titles and summaries instead of emitting markup', () => {
    for (const xml of [rss, atom]) {
      expect(xml).toContain('Tom &amp; Jerry &lt;script&gt;alert(1)&lt;/script&gt;');
      expect(xml).toContain(
        'Uses &lt;b&gt;HTML&lt;/b&gt; &amp; &quot;quotes&quot; in the summary.'
      );
      expect(xml).not.toContain('<script>');
      expect(xml).not.toContain('<b>');
      expect(xml).not.toContain('\u0007');
    }
  });

  it('use absolute URLs for every link', () => {
    const links = [
      ...rss.matchAll(/<link>([^<]+)<\/link>|href="([^"]+)"/g),
      ...atom.matchAll(/href="([^"]+)"/g),
    ];
    expect(links.length).toBeGreaterThan(4);
    for (const [, a, b] of links) expect(a ?? b).toMatch(/^https:\/\/ayagmar\.dev\//);
  });

  it('date RSS items in RFC 822 and Atom entries in RFC 3339', () => {
    expect(rss).toContain('<pubDate>Tue, 20 Oct 2026 00:00:00 GMT</pubDate>');
    expect(rss).toContain('<lastBuildDate>Thu, 22 Oct 2026 00:00:00 GMT</lastBuildDate>');
    expect(atom).toContain('<published>2026-10-20T00:00:00.000Z</published>');
    expect(atom).toContain('<updated>2026-10-22T00:00:00.000Z</updated>');
  });

  it('keep Atom ids when a post is edited or others are added', () => {
    const edited = publishedPosts(
      [
        post('newer', { date: new Date('2026-10-30T00:00:00Z') }),
        ...corpus.map((p) => ({
          ...p,
          data: { ...p.data, updated: new Date('2026-11-05T00:00:00Z'), title: 'Renamed' },
        })),
      ],
      false
    );
    const ids = (feed: string) =>
      [...feed.matchAll(/<entry>\s*<id>([^<]+)<\/id>/g)].map(([, id]) => id);
    expect(ids(renderAtom(buildFeed(edited)))).toEqual([
      'tag:ayagmar.dev,2026-10-30:/writing/newer',
      ...ids(atom),
    ]);
    expect(ids(atom)).toEqual([
      'tag:ayagmar.dev,2026-10-20:/writing/escaping',
      'tag:ayagmar.dev,2026-10-01:/writing/older',
    ]);
  });

  it('leave drafts out unless drafts are shown', () => {
    expect(rss).not.toContain('secret-draft');
    expect(atom).not.toContain('secret-draft');
    expect(renderRss(buildFeed(publishedPosts(corpus, true)))).toContain('/writing/secret-draft');
  });

  it('narrow a tag feed to that tag and point it at itself', () => {
    const tagged = buildFeed(published, 'ci');
    expect(tagged.entries.map((entry) => entry.url)).toEqual([
      'https://ayagmar.dev/writing/escaping',
    ]);
    expect(renderRss(tagged)).toContain(
      '<atom:link href="https://ayagmar.dev/writing/tags/ci/feed.xml" rel="self"'
    );
    expect(renderAtom(tagged)).toContain(
      '<link rel="self" type="application/atom+xml" href="https://ayagmar.dev/writing/tags/ci/atom.xml"/>'
    );
    expect(feedPaths('ci')).toEqual({
      rss: '/writing/tags/ci/feed.xml',
      atom: '/writing/tags/ci/atom.xml',
    });
  });

  it('render the same bytes for an empty feed on every build', () => {
    expect(renderAtom(buildFeed([]))).toBe(renderAtom(buildFeed([])));
    expect(renderRss(buildFeed([]))).not.toContain('<item>');
  });
});
