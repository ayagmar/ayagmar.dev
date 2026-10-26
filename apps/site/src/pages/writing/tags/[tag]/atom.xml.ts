import type { APIRoute, GetStaticPaths } from 'astro';
import { buildFeed, renderAtom } from '../../../../lib/feed.ts';
import { getPosts } from '../../../../lib/posts.ts';
import { postsByTag } from '../../../../lib/writing.ts';

export const getStaticPaths = (async () =>
  [...postsByTag(await getPosts()).keys()].map((tag) => ({
    params: { tag },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ params }) =>
  new Response(renderAtom(buildFeed(await getPosts(), params.tag)), {
    headers: { 'Content-Type': 'application/atom+xml; charset=utf-8' },
  });
