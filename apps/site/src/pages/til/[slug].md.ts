import type { APIRoute, GetStaticPaths } from 'astro';
import { noteArticle, renderArticleMarkdown } from '../../lib/article.ts';
import { getNotes } from '../../lib/posts.ts';
import type { Note } from '../../lib/til.ts';

export const getStaticPaths = (async () =>
  (await getNotes()).map((note) => ({
    params: { slug: note.id },
    props: { note },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute<{ note: Note }> = ({ props }) =>
  new Response(renderArticleMarkdown(noteArticle(props.note)), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
