// The room's frames for the terminal (ADR 0045), drawn from the scene's own PNGs at build time.
import { srcDir } from 'astro:config/server';
import { fileURLToPath } from 'node:url';
import type { APIRoute, GetStaticPaths } from 'astro';
import sharp from 'sharp';
import { type Frame, frames, shrink } from '../../lib/terminal-room.ts';

const layer = (name: string) => fileURLToPath(new URL(`assets/${name}.png`, srcDir));

export const getStaticPaths = (() =>
  Object.keys(frames).map((frame) => ({ params: { frame } }))) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ params }) => {
  const [room, view] = frames[params.frame as Frame];
  // Two steps: sharp flattens only after every other operation, so one pipeline would drop the
  // layer's transparency before it is composited.
  const composed = await sharp(layer(room))
    .composite([{ input: layer(view) }])
    .png()
    .toBuffer();
  const image = await sharp(composed).removeAlpha().raw().toBuffer();
  return new Response(new Uint8Array(shrink(image)));
};
