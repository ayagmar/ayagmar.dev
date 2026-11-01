/**
 * Link-preview images (src/lib/og.ts) and the favicon's PNG sizes, drawn at build time by the
 * endpoints under src/pages/. Every card is 1200x630 and the same: a 3:1 picture on the night
 * ground, the title in the site's serif under it, a muted line under that. A post with art
 * (ADR 0027) shows its art; every other card shows the night room. Only the build runs this:
 * sharp never reaches a page.
 */

import { publicDir, srcDir } from 'astro:config/server';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { ogSize } from './og.ts';

// The night tokens of src/styles/base.css: --ground, --text, --muted.
const ground = '#0e0c13';
const text = '#ebe5da';
const muted = '#a59eae';

const picture = { left: 120, top: 56, width: 960, height: 320 } as const;
// The title and the line under it, from 36 px under the picture to 40 px above the bottom.
const textBox = { top: 412, width: 960, height: 178 } as const;
// Twice --radius, as post art has on the page (ADR 0037), at the picture's scale.
const corner = 8;

const file = (dir: string | URL, path: string) => fileURLToPath(new URL(path, dir));
const serif = file(srcDir, 'fonts/ttf/serif-roman.ttf');
const mono = file(srcDir, 'fonts/ttf/mono.ttf');

const markup = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** The text block at one title size, wrapped at words and, inside a word too long for a line, at characters. */
async function renderText(title: string, line: string, size: number) {
  const { data, info } = await sharp({
    text: {
      text: `<span font="min7 Serif Semi-Bold ${size}" foreground="${text}">${markup(title)}</span>\n<span font="min7 Serif 14"> </span>\n<span font="min7 Serif 28" foreground="${muted}">${markup(line)}</span>`,
      fontfile: serif,
      width: textBox.width,
      dpi: 72,
      rgba: true,
      wrap: 'word-char',
    },
  })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { data, fits: info.width <= textBox.width && info.height <= textBox.height };
}

const titleSizes = [54, 48, 42, 36];

/**
 * The title, then a muted line in the text size, as one transparent PNG that fits the text box.
 * One Pango layout for both, since sharp crops text to its ink: two images would sit apart by
 * whatever the title's descenders happen to be. The title is 54 px, down to 36 px; a title that
 * still overflows at 36 px is cut at the longest prefix that fits, and ends in an ellipsis.
 */
async function textBlock(title: string, line: string): Promise<Buffer> {
  for (const size of titleSizes) {
    const block = await renderText(title, line, size);
    if (block.fits) return block.data;
  }
  const min = titleSizes.at(-1) ?? 36;
  // By code point, so a cut never splits a character in two.
  const characters = [...title];
  const cut = (length: number) => `${characters.slice(0, length).join('').trimEnd()}\u2026`;
  // Binary search for the longest prefix that fits; the empty one is just the ellipsis.
  let [low, high] = [0, characters.length - 1];
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((await renderText(cut(middle), line, min)).fits) low = middle;
    else high = middle - 1;
  }
  const block = await renderText(cut(low), line, min);
  if (!block.fits) throw new Error(`og-card: "${line}" does not fit the card's text box`);
  return block.data;
}

/**
 * The 3:1 picture, scaled to 960x320 with square pixels: post art from its SVG (the ascii kind
 * set in the site's mono), or the night room at twice its size.
 */
async function pictureImage(art: string | undefined) {
  if (art === undefined) {
    return sharp(file(srcDir, 'assets/room-night.png'))
      .resize(picture.width, picture.height, { kernel: 'nearest' })
      .toBuffer();
  }
  const viewWidth = Number(/viewBox="0 0 (\d+) /.exec(art)?.[1]);
  // The page styles the ascii kind's text from base.css (.post-art text); a lone SVG needs it
  // inline, as the first child of the root element.
  const svg = art.replace(
    /^<svg\b[^>]*>/,
    (open) => `${open}<style>text{font:10px "JetBrains Mono",monospace;white-space:pre}</style>`
  );
  return sharp(Buffer.from(svg), { density: (72 * picture.width) / viewWidth })
    .resize(picture.width, picture.height, { kernel: 'nearest' })
    .toBuffer();
}

const roundedMask = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${picture.width}" height="${picture.height}"><rect width="100%" height="100%" rx="${corner}"/></svg>`
);

/** A 1200x630 card: the picture (post art SVG, or the room), the title, and a muted line. */
export async function renderOgCard(card: {
  title: string;
  line: string;
  art?: string | undefined;
}): Promise<Buffer> {
  // librsvg finds fonts through fontconfig, which knows the mono only once sharp has loaded it.
  if (card.art !== undefined) await sharp({ text: { text: '.', fontfile: mono } }).toBuffer();
  const image = await sharp(await pictureImage(card.art))
    .composite([{ input: roundedMask, blend: 'dest-in' }])
    .png()
    .toBuffer();
  return sharp({ create: { ...ogSize, channels: 3, background: ground } })
    .composite([
      { input: image, left: picture.left, top: picture.top },
      { input: await textBlock(card.title, card.line), left: picture.left, top: textBox.top },
    ])
    .png({ palette: true, compressionLevel: 9, effort: 10 })
    .toBuffer();
}

/** The favicon at `size` px square, from public/favicon.svg. */
export function renderIcon(size: number, background?: string): Promise<Buffer> {
  const svg = readFileSync(file(publicDir, 'favicon.svg'));
  const icon = sharp(svg, { density: (72 * size) / 32 }).resize(size, size);
  return (background === undefined ? icon : icon.flatten({ background }))
    .png({ palette: true, compressionLevel: 9 })
    .toBuffer();
}

export const iconGround = ground;
