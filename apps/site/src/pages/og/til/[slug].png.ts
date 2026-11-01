// A TIL note's link-preview image: the night room and the note's title.
import type { APIRoute, GetStaticPaths } from 'astro';
import { renderOgCard } from '../../../lib/og-card.ts';
import { getNotes } from '../../../lib/posts.ts';
import { site } from '../../../lib/site.ts';

export const getStaticPaths = (async () =>
  (await getNotes()).map((note) => ({
    params: { slug: note.id },
    props: { note },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute<Awaited<ReturnType<typeof getStaticPaths>>[number]['props']> = async ({
  props: { note },
}) => {
  const png = await renderOgCard({ title: note.data.title, line: `${site.name} · TIL` });
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
