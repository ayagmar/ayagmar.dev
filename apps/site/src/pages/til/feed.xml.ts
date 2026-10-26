import type { APIRoute } from 'astro';
import { buildTilFeed, renderRss } from '../../lib/feed.ts';
import { getNotes } from '../../lib/posts.ts';

export const GET: APIRoute = async () =>
  new Response(renderRss(buildTilFeed(await getNotes())), {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
