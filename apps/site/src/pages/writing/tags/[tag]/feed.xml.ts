import type { APIRoute, GetStaticPaths } from 'astro';
import { buildFeed, renderRss, type WritingScope } from '../../../../lib/feed.ts';
import { getPosts } from '../../../../lib/posts.ts';
import { postsByTag } from '../../../../lib/writing.ts';

export const getStaticPaths = (async () =>
  [...postsByTag(await getPosts()).keys()].map((tag) => ({
    params: { tag },
    props: { scope: { tag } },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute<{ scope: WritingScope }> = async ({ props }) =>
  new Response(renderRss(buildFeed(await getPosts(), props.scope)), {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
