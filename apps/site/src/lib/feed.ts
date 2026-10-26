import type { ProjectSlug } from '@min7/contracts';
import { projectPath } from './projects.ts';
import { site, siteUrl } from './site.ts';
import { type Note, notePath, noteSummary } from './til.ts';
import { isoDay, lastUpdated, type Post, postPath, tagPath } from './writing.ts';

interface FeedEntry {
  /** Atom id: fixed once the post is published, whatever is edited later. */
  id: string;
  url: string;
  title: string;
  summary: string;
  published: Date;
  updated: Date;
  tags: readonly string[];
}

/** One feed, rendered as both RSS 2.0 and Atom 1.0. */
export interface Feed {
  id: string;
  title: string;
  description: string;
  htmlUrl: string;
  rssUrl: string;
  atomUrl: string;
  updated: Date;
  entries: FeedEntry[];
}

// `updated` of a feed with no entries, so empty feeds are byte-stable between builds.
const epoch = new Date('2026-10-26T00:00:00Z');

const absolute = (path: string) => new URL(path, siteUrl).href;

/** Which posts a feed carries: all of them, one tag's, or one project's. */
export type WritingScope = { tag: string } | { project: ProjectSlug };

/** A feed's scope: the writing scopes, or the TIL notes (ADR 0028). */
export type FeedScope = WritingScope | { til: true };

/** The page, title and description of a feed. */
export function feedScope(scope?: FeedScope) {
  if (scope === undefined) {
    return { page: '/writing', title: `${site.name} writing`, description: site.description };
  }
  if ('til' in scope) {
    return {
      page: '/til',
      title: `${site.name} TIL`,
      description: `Short today-I-learned notes on ${site.name}.`,
    };
  }
  if ('tag' in scope) {
    return {
      page: tagPath(scope.tag),
      title: `${site.name} writing tagged ${scope.tag}`,
      description: `Posts tagged ${scope.tag} on ${site.name}.`,
    };
  }
  return {
    page: projectPath(scope.project),
    title: `${site.name} writing about ${scope.project}`,
    description: `Posts about ${scope.project} on ${site.name}.`,
  };
}

/** Whether a scope's feed carries the post. */
function includes(scope: WritingScope | undefined, post: Post) {
  if (scope === undefined) return true;
  return 'tag' in scope
    ? post.data.tags.includes(scope.tag)
    : post.data.projects.includes(scope.project);
}

/** Paths of the site-wide feeds, or of one tag's, project's or the TIL feeds. */
export function feedPaths(scope?: FeedScope) {
  const base = scope === undefined ? '' : feedScope(scope).page;
  return { rss: `${base}/feed.xml`, atom: `${base}/atom.xml` };
}

function assemble(scope: FeedScope | undefined, entries: FeedEntry[]): Feed {
  const { page, title, description } = feedScope(scope);
  const paths = feedPaths(scope);
  const newest =
    entries.length === 0 ? epoch.getTime() : Math.max(...entries.map((e) => e.updated.getTime()));
  return {
    id: `tag:ayagmar.dev,2026:${page}`,
    title,
    description,
    htmlUrl: absolute(page),
    rssUrl: absolute(paths.rss),
    atomUrl: absolute(paths.atom),
    updated: new Date(newest),
    entries,
  };
}

/** `posts` must already be the published set; a scope narrows it to a tag or a project. */
export function buildFeed(posts: readonly Post[], scope?: WritingScope): Feed {
  return assemble(
    scope,
    posts
      .filter((post) => includes(scope, post))
      .map(
        (post): FeedEntry => ({
          id: `tag:ayagmar.dev,${isoDay(post.data.date)}:${postPath(post.id)}`,
          url: absolute(postPath(post.id)),
          title: post.data.title,
          summary: post.data.summary,
          published: post.data.date,
          updated: lastUpdated(post),
          tags: post.data.tags,
        })
      )
  );
}

/** `notes` must already be the published set. A note has no `updated`, so its id and date are fixed. */
export function buildTilFeed(notes: readonly Note[]): Feed {
  return assemble(
    { til: true },
    notes.map(
      (note): FeedEntry => ({
        id: `tag:ayagmar.dev,${isoDay(note.data.date)}:${notePath(note.id)}`,
        url: absolute(notePath(note.id)),
        title: note.data.title,
        summary: noteSummary(note),
        published: note.data.date,
        updated: note.data.date,
        tags: note.data.tags,
      })
    )
  );
}

// Characters XML 1.0 forbids even when escaped.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point.
const invalidXml = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const entities: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

/** Escapes text for an XML element or attribute value. */
function xml(text: string): string {
  return text.replace(invalidXml, '').replace(/[&<>"']/g, (char) => entities[char] ?? char);
}

export function renderRss(feed: Feed): string {
  const items = feed.entries.map(
    (entry) => `    <item>
      <title>${xml(entry.title)}</title>
      <link>${xml(entry.url)}</link>
      <guid isPermaLink="true">${xml(entry.url)}</guid>
      <pubDate>${entry.published.toUTCString()}</pubDate>
      <description>${xml(entry.summary)}</description>
${entry.tags.map((tag) => `      <category>${xml(tag)}</category>\n`).join('')}    </item>
`
  );
  return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xml(feed.title)}</title>
    <link>${xml(feed.htmlUrl)}</link>
    <description>${xml(feed.description)}</description>
    <language>en</language>
    <lastBuildDate>${feed.updated.toUTCString()}</lastBuildDate>
    <atom:link href="${xml(feed.rssUrl)}" rel="self" type="application/rss+xml"/>
${items.join('')}  </channel>
</rss>
`;
}

export function renderAtom(feed: Feed): string {
  const entries = feed.entries.map(
    (entry) => `  <entry>
    <id>${xml(entry.id)}</id>
    <title type="text">${xml(entry.title)}</title>
    <link rel="alternate" type="text/html" href="${xml(entry.url)}"/>
    <published>${entry.published.toISOString()}</published>
    <updated>${entry.updated.toISOString()}</updated>
    <summary type="text">${xml(entry.summary)}</summary>
${entry.tags.map((tag) => `    <category term="${xml(tag)}"/>\n`).join('')}  </entry>
`
  );
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en">
  <id>${xml(feed.id)}</id>
  <title type="text">${xml(feed.title)}</title>
  <subtitle type="text">${xml(feed.description)}</subtitle>
  <link rel="self" type="application/atom+xml" href="${xml(feed.atomUrl)}"/>
  <link rel="alternate" type="text/html" href="${xml(feed.htmlUrl)}"/>
  <updated>${feed.updated.toISOString()}</updated>
  <author><name>${xml(site.author)}</name><uri>${xml(siteUrl)}</uri></author>
${entries.join('')}</feed>
`;
}
