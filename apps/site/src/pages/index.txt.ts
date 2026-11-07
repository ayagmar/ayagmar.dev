import { WORKERS_CI_BRANCH } from 'astro:env/server';
import type { APIRoute } from 'astro';
import { buildOrigin } from '../lib/og.ts';
import { renderPlainText, textFile } from '../lib/plaintext.ts';
import { getNotes, getPosts, getProjects } from '../lib/posts.ts';

export const GET: APIRoute = async () => {
  const { projects } = await getProjects();
  return textFile(
    renderPlainText(
      await getPosts(),
      await getNotes(),
      projects.map((project) => project.slug),
      buildOrigin(WORKERS_CI_BRANCH)
    )
  );
};
