import type { APIRoute } from 'astro';
import { buildFeed, renderAtom } from '../lib/feed.ts';
import { getPosts } from '../lib/posts.ts';

export const GET: APIRoute = async () =>
  new Response(renderAtom(buildFeed(await getPosts())), {
    headers: { 'Content-Type': 'application/atom+xml; charset=utf-8' },
  });
