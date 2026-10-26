import { describe, expect, it } from 'vitest';
import { buildFeed, buildTilFeed, feedPaths, renderAtom, renderRss } from '../src/lib/feed.ts';
import type { Note } from '../src/lib/til.ts';
import type { Post } from '../src/lib/writing.ts';
import { publishedEntries } from '../src/lib/writing.ts';

const post = (id: string, data: Partial<Post['data']> = {}): Post => ({
  id,
  data: {
    title: `Title ${id}`,
    date: new Date('2026-10-01T00:00:00Z'),
    summary: `Summary ${id}`,
    tags: [],
    draft: false,
    projects: [],
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
    projects: ['runnerd'],
  }),
  post('older', { tags: ['rust'], projects: ['ccdesk'] }),
  post('secret-draft', {
    draft: true,
    tags: ['rust'],
    projects: ['runnerd'],
    date: new Date('2026-10-25T00:00:00Z'),
  }),
];
const published = publishedEntries(corpus, false);

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
    const edited = publishedEntries(
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
    expect(renderRss(buildFeed(publishedEntries(corpus, true)))).toContain('/writing/secret-draft');
  });

  it('narrow a tag feed to that tag and point it at itself', () => {
    const tagged = buildFeed(published, { tag: 'ci' });
    expect(tagged.entries.map((entry) => entry.url)).toEqual([
      'https://ayagmar.dev/writing/escaping',
    ]);
    expect(renderRss(tagged)).toContain(
      '<atom:link href="https://ayagmar.dev/writing/tags/ci/feed.xml" rel="self"'
    );
    expect(renderAtom(tagged)).toContain(
      '<link rel="self" type="application/atom+xml" href="https://ayagmar.dev/writing/tags/ci/atom.xml"/>'
    );
    expect(feedPaths({ tag: 'ci' })).toEqual({
      rss: '/writing/tags/ci/feed.xml',
      atom: '/writing/tags/ci/atom.xml',
    });
  });

  // A project feed that filtered on tags, or on the unpublished set, would leak other posts.
  it('narrow a project feed to that project, without drafts, and point it at itself', () => {
    const project = buildFeed(published, { project: 'runnerd' });
    expect(project.entries.map((entry) => entry.url)).toEqual([
      'https://ayagmar.dev/writing/escaping',
    ]);
    expect(project.id).toBe('tag:ayagmar.dev,2026:/projects/runnerd');
    expect(renderAtom(project)).toContain(
      '<link rel="self" type="application/atom+xml" href="https://ayagmar.dev/projects/runnerd/atom.xml"/>'
    );
    expect(renderRss(project)).toContain(
      '<atom:link href="https://ayagmar.dev/projects/runnerd/feed.xml" rel="self"'
    );
    expect(buildFeed(published, { project: 'headroom' }).entries).toEqual([]);
  });

  it('render the same bytes for an empty feed on every build', () => {
    expect(renderAtom(buildFeed([]))).toBe(renderAtom(buildFeed([])));
    expect(renderRss(buildFeed([]))).not.toContain('<item>');
  });

  // Golden files written by the code before TIL notes existed: catches any change to the bytes
  // or ids of the writing feeds, which readers' feed software has already stored (ADR 0021).
  it.each([
    ['site-wide', undefined],
    ['tag', { tag: 'rust' }],
    ['project', { project: 'runnerd' }],
  ] as const)('writes the %s feed exactly as before TIL notes', async (name, scope) => {
    const feed = buildFeed(published, scope);
    await expect(renderRss(feed)).toMatchFileSnapshot(`golden/feed-${name}.xml`);
    await expect(renderAtom(feed)).toMatchFileSnapshot(`golden/atom-${name}.xml`);
  });
});

const note = (id: string, data: Partial<Note['data']> = {}, body?: string): Note => ({
  id,
  data: {
    title: `Note ${id}`,
    date: new Date('2026-10-18T00:00:00Z'),
    tags: [],
    draft: false,
    ...data,
  },
  body: body ?? `Body of ${id}.`,
});

describe('TIL feeds', () => {
  const notes = publishedEntries(
    [
      note('older', { tags: ['shell'] }),
      note('newer', { date: new Date('2026-10-21T00:00:00Z') }),
      note('secret', { draft: true, date: new Date('2026-10-25T00:00:00Z') }),
    ],
    false
  );

  // Catches a note's id following its title or file, which feed readers store (ADR 0021).
  it('give a note the tag URI of its date and slug, whatever else changes', () => {
    const ids = (list: Note[]) =>
      [...renderAtom(buildTilFeed(list)).matchAll(/<entry>\s*<id>([^<]+)<\/id>/g)].map(
        ([, id]) => id
      );
    expect(ids(notes)).toEqual([
      'tag:ayagmar.dev,2026-10-21:/til/newer',
      'tag:ayagmar.dev,2026-10-18:/til/older',
    ]);
    const edited = notes.map((n) => ({
      ...n,
      body: 'Rewritten.',
      data: { ...n.data, title: 'New' },
    }));
    expect(ids(edited)).toEqual(ids(notes));
  });

  it('carry the note, its own paths and no draft', () => {
    const feed = buildTilFeed(notes);
    expect(feed.id).toBe('tag:ayagmar.dev,2026:/til');
    expect(feedPaths({ til: true })).toEqual({ rss: '/til/feed.xml', atom: '/til/atom.xml' });
    const rss = renderRss(feed);
    expect(rss).toContain('<link>https://ayagmar.dev/til/newer</link>');
    expect(rss).toContain('<description>Body of newer.</description>');
    expect(rss).toContain('<atom:link href="https://ayagmar.dev/til/feed.xml" rel="self"');
    expect(rss).not.toContain('secret');
    expect(renderAtom(feed)).not.toContain('secret');
  });

  it('are valid and byte-stable when empty', () => {
    expect(renderRss(buildTilFeed([]))).not.toContain('<item>');
    expect(renderAtom(buildTilFeed([]))).toBe(renderAtom(buildTilFeed([])));
    expect(renderAtom(buildTilFeed([]))).toContain('<updated>2026-10-26T00:00:00.000Z</updated>');
  });
});
