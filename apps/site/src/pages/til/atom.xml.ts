import type { APIRoute } from 'astro';
import { buildTilFeed, renderAtom } from '../../lib/feed.ts';
import { getNotes } from '../../lib/posts.ts';

export const GET: APIRoute = async () =>
  new Response(renderAtom(buildTilFeed(await getNotes())), {
    headers: { 'Content-Type': 'application/atom+xml; charset=utf-8' },
  });
