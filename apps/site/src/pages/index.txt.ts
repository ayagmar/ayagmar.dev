import type { APIRoute } from 'astro';
import { renderPlainText } from '../lib/plaintext.ts';
import { getPosts } from '../lib/posts.ts';

export const GET: APIRoute = async () =>
  new Response(renderPlainText(await getPosts()), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
