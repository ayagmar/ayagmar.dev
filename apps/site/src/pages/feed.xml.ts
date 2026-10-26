import type { APIRoute } from 'astro';
import { buildFeed, renderRss } from '../lib/feed.ts';
import { getPosts } from '../lib/posts.ts';

export const GET: APIRoute = async () =>
  new Response(renderRss(buildFeed(await getPosts())), {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
