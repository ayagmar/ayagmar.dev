import type { APIRoute } from 'astro';
import { renderPlainText } from '../lib/plaintext.ts';
import { getNotes, getPosts, getProjects } from '../lib/posts.ts';

export const GET: APIRoute = async () => {
  const { projects } = await getProjects();
  const text = renderPlainText(
    await getPosts(),
    await getNotes(),
    projects.map((project) => project.slug)
  );
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
