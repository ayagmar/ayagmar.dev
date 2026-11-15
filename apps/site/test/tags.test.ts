import { describe, expect, it } from 'vitest';
import { notePath } from '../src/lib/til.ts';
import { tilSchema } from '../src/lib/til-schema.ts';
import { postPath, publishedEntries, taggedEntries, tagPath } from '../src/lib/writing.ts';
import { writingSchema } from '../src/lib/writing-schema.ts';

const post = (id: string, date: string, tags: string[], draft = false) => ({
  id,
  data: writingSchema.parse({ title: `Post ${id}`, date, summary: 'One.', tags, draft }),
});
const note = (id: string, date: string, tags: string[], draft = false) => ({
  id,
  data: tilSchema.parse({ title: `Note ${id}`, date, tags, draft }),
});

const posts = [
  post('runners', '2026-10-20', ['ci', 'rust']),
  post('older', '2026-10-01', ['ci']),
  post('soon', '2026-10-25', ['secret'], true),
];
const notes = [
  note('ssd', '2026-11-14', ['ci', 'btrfs']),
  note('runners', '2026-10-05', ['ci']),
  note('later', '2026-11-20', ['secret'], true),
];

/** What a tag page would list: the tag, then the paths of its posts and of its notes. */
const pages = (showDrafts: boolean) =>
  taggedEntries(publishedEntries(posts, showDrafts), publishedEntries(notes, showDrafts)).map(
    (entry) => ({
      path: tagPath(entry.tag),
      posts: entry.posts.map((p) => postPath(p.id)),
      notes: entry.notes.map((n) => notePath(n.id)),
    })
  );

describe('tag pages', () => {
  // Catches a tag only notes use getting no page (tags were built from posts alone), one only
  // posts use losing it, and a tag both use listing one kind, out of order or twice. The
  // post and the note named "runners" are two entries, not one.
  it('cover every tag posts or notes use, posts and notes each newest first', () => {
    expect(pages(false)).toEqual([
      { path: '/tags/btrfs', posts: [], notes: ['/til/ssd'] },
      {
        path: '/tags/ci',
        posts: ['/writing/runners', '/writing/older'],
        notes: ['/til/ssd', '/til/runners'],
      },
      { path: '/tags/rust', posts: ['/writing/runners'], notes: [] },
    ]);
  });
});
