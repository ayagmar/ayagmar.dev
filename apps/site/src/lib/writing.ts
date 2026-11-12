import { nav, nowPage } from './site.ts';
import type { WritingFrontmatter } from './writing-schema.ts';

/** A post as every renderer sees it; `id` is the file name without `.md`, `body` its Markdown. */
export interface Post {
  id: string;
  data: WritingFrontmatter;
  body?: string | undefined;
}

export const postPath = (id: string) => `/writing/${id}`;
export const tagPath = (tag: string) => `/writing/tags/${tag}`;

/** What publishing needs of a post or a TIL note. */
interface Dated {
  id: string;
  data: { date: Date; draft: boolean };
}

/** Posts or notes to publish, newest first. Drafts only when `showDrafts` is set (PR previews). */
export function publishedEntries<E extends Dated>(entries: readonly E[], showDrafts: boolean): E[] {
  return entries
    .filter((entry) => showDrafts || !entry.data.draft)
    .toSorted((a, b) => b.data.date.getTime() - a.data.date.getTime() || a.id.localeCompare(b.id));
}

/** Every tag with its posts, tags sorted by name, posts in the given order. */
export function postsByTag<P extends Post>(posts: readonly P[]): Map<string, P[]> {
  const byTag = new Map<string, P[]>();
  for (const post of posts) {
    for (const tag of post.data.tags) byTag.set(tag, [...(byTag.get(tag) ?? []), post]);
  }
  return new Map([...byTag].sort(([a], [b]) => a.localeCompare(b)));
}

export const lastUpdated = (post: Post) => post.data.updated ?? post.data.date;

/** `2026-10-26`, in UTC like the frontmatter dates. */
export const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/** What /writing, /til and their text copies say while they have nothing to list. */
export const nothingYet = {
  writing: "No posts yet. They'll be about software I build and the tools I use.",
  til: "No notes yet. They'll be short, one thing at a time, picked up while working.",
} as const;

/** What an empty /writing or /til says before the pages that do have something to read. */
export const meanwhile = 'Until then, try';

/**
 * Where the 404 and an empty /writing or /til send a reader, in the nav's order. Writing and TIL
 * join once they list something, so neither empty section points at the other, and both come
 * back without an edit when the first entry is published.
 */
export function pagesToRead({ posts, notes }: { posts: number; notes: number }) {
  const shown = new Set<string>([
    ...(posts > 0 ? ['/writing'] : []),
    ...(notes > 0 ? ['/til'] : []),
    '/projects',
    '/about',
  ]);
  return [...nav.filter((item) => shown.has(item.href)), nowPage];
}

/** What Search offers when it finds nothing: the pages most readers come for. */
export const searchFallback = ['/projects', '/about', '/stats'].flatMap((href) =>
  nav.filter((item) => item.href === href)
);

/**
 * The header's link while Search has not hydrated or scripts are off: the posts once there are
 * some, the projects until then, so it is never a link to an empty page.
 */
export const browseLink = (posts: number) =>
  posts > 0
    ? { href: '/writing', label: 'Browse writing' }
    : { href: '/projects', label: 'Browse projects' };

/** What a day or year page says when nothing was published in it. */
export const nothingPublishedThen = 'Nothing published.';

/** Whole minutes to read a post's Markdown at 220 words a minute, never under one. */
export const readingMinutes = (markdown: string) =>
  Math.max(1, Math.round(markdown.split(/\s+/).filter(Boolean).length / 220));

/**
 * The parts of `post`'s series in date order, `post` among them, from `posts`, the posts this
 * build shows (drafts only where drafts are built). Empty outside a series or in a series of one.
 */
export function seriesParts<P extends Post>(posts: readonly P[], post: P): P[] {
  const { series } = post.data;
  if (series === undefined) return [];
  const parts = posts
    .filter((part) => part.data.series === series)
    .toSorted((a, b) => a.data.date.getTime() - b.data.date.getTime() || a.id.localeCompare(b.id));
  return parts.length > 1 ? parts : [];
}
