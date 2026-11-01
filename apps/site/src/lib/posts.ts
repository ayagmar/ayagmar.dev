import { getCollection } from 'astro:content';
import { PUBLIC_SHOW_DRAFTS } from 'astro:env/server';
import { signals } from '../data/signals.ts';
import { dayPages, type History, type Published } from './days.ts';
import { siteProjects } from './projects.ts';
import { notePath } from './til.ts';
import { isoDay, postPath, publishedEntries } from './writing.ts';

const showDrafts = PUBLIC_SHOW_DRAFTS === '1';

/** Every post this build publishes, newest first. */
export async function getPosts() {
  return publishedEntries(await getCollection('writing'), showDrafts);
}

/** Every TIL note this build publishes, newest first. */
export async function getNotes() {
  return publishedEntries(await getCollection('til'), showDrafts);
}

/**
 * Every featured project with its file entry (for rendering the description) and the
 * projects envelope (for the freshness line).
 */
export async function getProjects() {
  const files = await getCollection('projects');
  const envelope = await signals.read('projects');
  const projects = siteProjects(
    files.map((file) => file.data),
    envelope.data?.projects ?? null
  ).map((project) => ({ ...project, file: files.find((file) => file.id === project.slug) }));
  return { projects, envelope };
}

/**
 * The daily history, read whole (ADR 0038), and the day pages it and the published writing
 * make (src/lib/days.ts): for the day pages, the strip's links and the receipts.
 */
export async function getDays() {
  const [shipping, usage, posts, notes] = await Promise.all([
    signals.readHistory('shipping-activity'),
    signals.readHistory('llm-usage'),
    getPosts(),
    getNotes(),
  ]);
  const history: History = { shipping: shipping?.days ?? null, usage: usage?.days ?? null };
  const published: Published[] = [
    ...posts.map((post) => ({
      date: isoDay(post.data.date),
      title: post.data.title,
      path: postPath(post.id),
      kind: 'Post' as const,
    })),
    ...notes.map((note) => ({
      date: isoDay(note.data.date),
      title: note.data.title,
      path: notePath(note.id),
      kind: 'Note' as const,
    })),
  ];
  const pages = dayPages(history, published);
  return { history, pages, dates: new Set(pages.map((page) => page.date)) };
}
