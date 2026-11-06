import type { APIRoute, GetStaticPaths } from 'astro';
import { postArticle, renderArticleMarkdown } from '../../lib/article.ts';
import { getPosts } from '../../lib/posts.ts';
import type { Post } from '../../lib/writing.ts';

export const getStaticPaths = (async () =>
  (await getPosts()).map((post) => ({
    params: { slug: post.id },
    props: { post },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute<{ post: Post }> = ({ props }) =>
  new Response(renderArticleMarkdown(postArticle(props.post)), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
