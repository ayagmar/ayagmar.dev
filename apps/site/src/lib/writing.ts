import type { WritingFrontmatter } from './writing-schema.ts';

/** A post as every renderer sees it; `id` is the file name without `.md`. */
export interface Post {
  id: string;
  data: WritingFrontmatter;
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
