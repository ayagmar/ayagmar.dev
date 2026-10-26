import { getCollection } from 'astro:content';
import { PUBLIC_SHOW_DRAFTS } from 'astro:env/server';
import { signals } from '../data/signals.ts';
import { siteProjects } from './projects.ts';
import { publishedPosts } from './writing.ts';

const showDrafts = PUBLIC_SHOW_DRAFTS === '1';

/** Every post this build publishes, newest first. */
export async function getPosts() {
  return publishedPosts(await getCollection('writing'), showDrafts);
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
