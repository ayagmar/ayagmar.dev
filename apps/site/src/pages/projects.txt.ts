import type { APIRoute } from 'astro';
import { renderProjectsText, textFile } from '../lib/plaintext.ts';
import { getPosts, getProjects } from '../lib/posts.ts';

export const GET: APIRoute = async () =>
  textFile(renderProjectsText((await getProjects()).projects, await getPosts()));
