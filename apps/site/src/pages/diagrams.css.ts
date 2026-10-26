// The classes that replace the style="" attributes of every published diagram (ADR 0024).
import { render } from 'astro:content';
import type { APIRoute } from 'astro';
import { diagramStyles, diagramStylesheet } from '../lib/markdown/diagrams.ts';
import { getNotes, getPosts } from '../lib/posts.ts';

export const GET: APIRoute = async () => {
  const entries = [...(await getPosts()), ...(await getNotes())];
  const styles = await Promise.all(
    entries.map(async (entry) => diagramStyles((await render(entry)).remarkPluginFrontmatter))
  );
  return new Response(diagramStylesheet(styles), {
    headers: { 'Content-Type': 'text/css; charset=utf-8' },
  });
};
