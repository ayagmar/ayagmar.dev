import { getCollection } from 'astro:content';
import { PUBLIC_SHOW_DRAFTS } from 'astro:env/server';
import { publishedPosts } from './writing.ts';

const showDrafts = PUBLIC_SHOW_DRAFTS === '1';

/** Every post this build publishes, newest first. */
export async function getPosts() {
  return publishedPosts(await getCollection('writing'), showDrafts);
}
