import { getEntry } from 'astro:content';
import { WORKERS_CI_BRANCH } from 'astro:env/server';
import type { APIRoute } from 'astro';
import { buildOrigin } from '../lib/og.ts';
import { renderPlainText, textFile } from '../lib/plaintext.ts';
import { getNotes, getPosts, getProjects } from '../lib/posts.ts';

export const GET: APIRoute = async () => {
  const { projects } = await getProjects();
  const about = await getEntry('about', 'about');
  if (about === undefined) throw new Error('content/about.json is missing');
  return textFile(
    renderPlainText(
      about.data.summary,
      await getPosts(),
      await getNotes(),
      projects,
      buildOrigin(WORKERS_CI_BRANCH)
    )
  );
};
