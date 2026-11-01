// /favicon.ico for browsers and tools that ask for it by name: public/favicon.svg at 16 and
// 32 px, as PNG images in an ICO container.
import type { APIRoute } from 'astro';
import { renderIcon } from '../lib/og-card.ts';

export const GET: APIRoute = async () => {
  const sizes = [16, 32];
  const images = await Promise.all(sizes.map((size) => renderIcon(size)));
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((image, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(sizes[i] ?? 0, entry);
    header.writeUInt8(sizes[i] ?? 0, entry + 1);
    header.writeUInt16LE(1, entry + 4); // colour planes
    header.writeUInt16LE(32, entry + 6); // bits per pixel
    header.writeUInt32LE(image.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  });
  return new Response(new Uint8Array(Buffer.concat([header, ...images])), {
    headers: { 'Content-Type': 'image/x-icon' },
  });
};
