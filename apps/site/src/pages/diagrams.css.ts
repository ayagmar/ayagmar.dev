// The classes that replace the style="" attributes of every published diagram (ADR 0024).
import { render } from 'astro:content';
import type { APIRoute } from 'astro';
import { diagramStyles, diagramStylesheet } from '../lib/markdown/diagrams.ts';
import { getPosts } from '../lib/posts.ts';

export const GET: APIRoute = async () => {
  const posts = await getPosts();
  const styles = await Promise.all(
    posts.map(async (post) => diagramStyles((await render(post)).remarkPluginFrontmatter))
  );
  return new Response(diagramStylesheet(styles), {
    headers: { 'Content-Type': 'text/css; charset=utf-8' },
  });
};
