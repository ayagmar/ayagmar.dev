import type { APIRoute } from 'astro';
import { renderPlainText, textFile } from '../lib/plaintext.ts';
import { getNotes, getPosts, getProjects } from '../lib/posts.ts';

export const GET: APIRoute = async () => {
  const { projects } = await getProjects();
  return textFile(
    renderPlainText(
      await getPosts(),
      await getNotes(),
      projects.map((project) => project.slug)
    )
  );
};
