// A TIL note's link-preview image: its art (ADR 0027), or the night room, and its title.
import type { APIRoute, GetStaticPaths } from 'astro';
import { renderNoteArt } from '../../../lib/art-files.ts';
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
  const { title, art } = note.data;
  const png = await renderOgCard({
    title,
    line: `${site.name} · TIL`,
    art: art === undefined ? undefined : renderNoteArt(art),
  });
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
