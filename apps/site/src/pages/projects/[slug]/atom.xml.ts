import { featuredProjects } from '@min7/contracts';
import type { APIRoute, GetStaticPaths } from 'astro';
import { buildFeed, renderAtom, type WritingScope } from '../../../lib/feed.ts';
import { getPosts } from '../../../lib/posts.ts';

export const getStaticPaths = (() =>
  featuredProjects.map(({ slug }) => ({
    params: { slug },
    props: { scope: { project: slug } },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute<{ scope: WritingScope }> = async ({ props }) =>
  new Response(renderAtom(buildFeed(await getPosts(), props.scope)), {
    headers: { 'Content-Type': 'application/atom+xml; charset=utf-8' },
  });
