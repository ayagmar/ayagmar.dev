import type { APIRoute, GetStaticPaths } from 'astro';
import { postArticle, renderArticleText } from '../../lib/article.ts';
import { textFile } from '../../lib/plaintext.ts';
import { getPosts } from '../../lib/posts.ts';
import type { Post } from '../../lib/writing.ts';

export const getStaticPaths = (async () =>
  (await getPosts()).map((post) => ({
    params: { slug: post.id },
    props: { post },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute<{ post: Post }> = ({ props }) =>
  textFile(renderArticleText(postArticle(props.post)));
