import { WORKERS_CI_BRANCH } from 'astro:env/server';
import type { APIRoute } from 'astro';
import { renderLlmsTxt } from '../lib/llms.ts';
import { buildOrigin } from '../lib/og.ts';
import { textFile } from '../lib/plaintext.ts';
import { getNotes, getPosts, getProjects } from '../lib/posts.ts';

export const GET: APIRoute = async () =>
  textFile(
    renderLlmsTxt(
      await getPosts(),
      await getNotes(),
      (await getProjects()).projects,
      buildOrigin(WORKERS_CI_BRANCH)
    )
  );
