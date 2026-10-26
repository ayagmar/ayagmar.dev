import type { APIRoute, GetStaticPaths } from 'astro';
import { buildFeed, type FeedScope, renderAtom } from '../../../../lib/feed.ts';
import { getPosts } from '../../../../lib/posts.ts';
import { postsByTag } from '../../../../lib/writing.ts';

export const getStaticPaths = (async () =>
  [...postsByTag(await getPosts()).keys()].map((tag) => ({
    params: { tag },
    props: { scope: { tag } },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute<{ scope: FeedScope }> = async ({ props }) =>
  new Response(renderAtom(buildFeed(await getPosts(), props.scope)), {
    headers: { 'Content-Type': 'application/atom+xml; charset=utf-8' },
  });
