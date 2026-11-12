// A project page's link-preview image: the night room, the project's name in the code face and
// its tagline.
import type { APIRoute, GetStaticPaths } from 'astro';
import { renderOgCard } from '../../../lib/og-card.ts';
import { getProjects } from '../../../lib/posts.ts';
import { site } from '../../../lib/site.ts';

export const getStaticPaths = (async () =>
  (await getProjects()).projects.map((project) => ({
    params: { slug: project.slug },
    props: { project },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute<Awaited<ReturnType<typeof getStaticPaths>>[number]['props']> = async ({
  props: { project },
}) => {
  const png = await renderOgCard({
    title: project.slug,
    line: project.summary ?? `${site.name} · Projects`,
    mono: true,
  });
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
