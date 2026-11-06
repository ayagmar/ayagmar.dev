import type { APIRoute } from 'astro';
import { renderTilText, textFile } from '../lib/plaintext.ts';
import { getNotes } from '../lib/posts.ts';

export const GET: APIRoute = async () => textFile(renderTilText(await getNotes()));
