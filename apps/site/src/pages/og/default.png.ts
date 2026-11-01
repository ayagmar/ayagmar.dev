// The link-preview image of every page without its own: the night room and the site's name.
import type { APIRoute } from 'astro';
import { renderOgCard } from '../../lib/og-card.ts';
import { site } from '../../lib/site.ts';

export const GET: APIRoute = async () =>
  new Response(new Uint8Array(await renderOgCard({ title: site.name, line: site.description })), {
    headers: { 'Content-Type': 'image/png' },
  });
