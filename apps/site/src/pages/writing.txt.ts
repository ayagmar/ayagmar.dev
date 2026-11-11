import type { APIRoute } from 'astro';
import { renderWritingText, textFile } from '../lib/plaintext.ts';
import { getNotes, getPosts } from '../lib/posts.ts';

export const GET: APIRoute = async () =>
  textFile(renderWritingText(await getPosts(), await getNotes()));
