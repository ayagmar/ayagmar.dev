// The home-screen icon iOS asks for: public/favicon.svg at 180 px on an opaque ground, since
// iOS draws transparency as black and rounds the corners itself.
import type { APIRoute } from 'astro';
import { iconGround, renderIcon } from '../lib/og-card.ts';

export const GET: APIRoute = async () =>
  new Response(new Uint8Array(await renderIcon(180, iconGround)), {
    headers: { 'Content-Type': 'image/png' },
  });
