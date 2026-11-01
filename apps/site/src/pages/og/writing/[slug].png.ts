// A post's link-preview image: its art (ADR 0027), or the night room, and its title.
import type { APIRoute, GetStaticPaths } from 'astro';
import { renderArt } from '../../../lib/art.ts';
import { renderOgCard } from '../../../lib/og-card.ts';
import { getPosts } from '../../../lib/posts.ts';
import { site } from '../../../lib/site.ts';

export const getStaticPaths = (async () =>
  (await getPosts()).map((post) => ({
    params: { slug: post.id },
    props: { post },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute<Awaited<ReturnType<typeof getStaticPaths>>[number]['props']> = async ({
  props: { post },
}) => {
  const { title, art } = post.data;
  const png = await renderOgCard({
    title,
    line: `${site.name} · Writing`,
    art: art === undefined ? undefined : renderArt(post.id, art),
  });
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
