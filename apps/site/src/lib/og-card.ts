/**
 * Link-preview images (src/lib/og.ts) and the favicon's PNG sizes, drawn at build time by the
 * endpoints under src/pages/. Every card is 1200x630 and the same: a 3:1 picture on the night
 * ground, the title in the site's serif (a project's name in its mono) under it, a muted line
 * under that. A post with art
 * (ADR 0027) shows its art; every other card shows the night room. Only the build runs this:
 * sharp never reaches a page.
 */

import { publicDir, srcDir } from 'astro:config/server';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dayMs, utcDate } from '@min7/contracts/rabat';
import sharp, { type OverlayOptions } from 'sharp';
import { ogSize } from './og.ts';
import { site } from './site.ts';
import type { YearPage } from './years.ts';

// The night tokens of src/styles/base.css: --ground, --text, --muted.
const ground = '#0e0c13';
const text = '#ebe5da';
const muted = '#a59eae';

const picture = { left: 120, top: 56, width: 960, height: 320 } as const;
// The title and the line under it, from 36 px under the picture to 40 px above the bottom.
const textBox = { top: 412, width: 960, height: 178 } as const;
// Twice --radius, as code blocks have on the page (ADR 0037), at the picture's scale.
const corner = 8;

const file = (dir: string | URL, path: string) => fileURLToPath(new URL(path, dir));
const serif = file(srcDir, 'fonts/ttf/serif-roman.ttf');
const mono = file(srcDir, 'fonts/ttf/mono.ttf');

/**
 * libvips adds a text's `fontfile` to fontconfig for the rest of the process, and Pango
 * remembers a family it could not find: a layout that names "min7 Mono" before that file is
 * added gets a system monospace for good. So both files are added, by drawing nothing much
 * with each, before any layout is drawn.
 */
const fontsAdded = (async () => {
  for (const fontfile of [mono, serif]) {
    await sharp({ text: { text: '.', fontfile, rgba: true } })
      .png()
      .toBuffer();
  }
})();

const markup = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** Pango markup in the site's faces as a transparent PNG, wrapped to `width`, cropped to its ink. */
const pango = async (marked: string, width: number) => {
  await fontsAdded;
  return sharp({
    text: { text: marked, fontfile: serif, width, dpi: 72, rgba: true, wrap: 'word-char' },
  })
    .png()
    .toBuffer({ resolveWithObject: true });
};

/** The title's face: the serif, or the code face for a name that is code, as a project's is. */
type TitleFace = 'serif' | 'mono';
const titleFont = { serif: 'min7 Serif Semi-Bold', mono: 'min7 Mono Semi-Bold' } as const;

/** A title, a gap and a muted line, as one Pango layout (see `textBlock`). */
const titled = (title: string, size: number, line: string, lineSize: number, face: TitleFace) =>
  `<span font="${titleFont[face]} ${size}" foreground="${text}">${markup(title)}</span>\n<span font="min7 Serif 14"> </span>\n<span font="min7 Serif ${lineSize}" foreground="${muted}">${markup(line)}</span>`;

/** The text block at one title size, wrapped at words and, inside a word too long for a line, at characters. */
async function renderText(title: string, line: string, size: number, face: TitleFace) {
  const { data, info } = await pango(titled(title, size, line, 28, face), textBox.width);
  return { data, fits: info.width <= textBox.width && info.height <= textBox.height };
}

const titleSizes = [54, 48, 42, 36];

/**
 * The title, then a muted line in the text size, as one transparent PNG that fits the text box.
 * One Pango layout for both, since sharp crops text to its ink: two images would sit apart by
 * whatever the title's descenders happen to be. The title is 54 px, down to 36 px; a title that
 * still overflows at 36 px is cut at the longest prefix that fits, and ends in an ellipsis.
 */
async function textBlock(title: string, line: string, face: TitleFace): Promise<Buffer> {
  for (const size of titleSizes) {
    const block = await renderText(title, line, size, face);
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
    if ((await renderText(cut(middle), line, min, face)).fits) low = middle;
    else high = middle - 1;
  }
  const block = await renderText(cut(low), line, min, face);
  if (!block.fits) throw new Error(`og-card: "${line}" does not fit the card's text box`);
  return block.data;
}

/** The 3:1 picture, scaled to 960x320: post art from its SVG, or the night room at twice its size. */
async function pictureImage(art: string | undefined) {
  if (art === undefined) {
    return sharp(file(srcDir, 'assets/room-night.png'))
      .resize(picture.width, picture.height, { kernel: 'nearest' })
      .toBuffer();
  }
  const viewWidth = Number(/viewBox="0 0 (\d+) /.exec(art)?.[1]);
  return sharp(Buffer.from(art), { density: (72 * picture.width) / viewWidth })
    .resize(picture.width, picture.height, { kernel: 'nearest' })
    .toBuffer();
}

const roundedMask = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${picture.width}" height="${picture.height}"><rect width="100%" height="100%" rx="${corner}"/></svg>`
);

/**
 * A 1200x630 card: the picture (post art SVG, or the room), the title, and a muted line. `mono`
 * sets the title in the code face, as the site sets a project's name.
 */
export async function renderOgCard(card: {
  title: string;
  line: string;
  art?: string | undefined;
  mono?: boolean;
}): Promise<Buffer> {
  const image = await sharp(await pictureImage(card.art))
    .composite([{ input: roundedMask, blend: 'dest-in' }])
    .png()
    .toBuffer();
  return sharp({ create: { ...ogSize, channels: 3, background: ground } })
    .composite([
      { input: image, left: picture.left, top: picture.top },
      {
        input: await textBlock(card.title, card.line, card.mono === true ? 'mono' : 'serif'),
        left: picture.left,
        top: textBox.top,
      },
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

// The night heat ramp of src/styles/base.css in sRGB: --rule for a recorded zero, then --heat-1
// to --heat-4 (oklch there).
const heat = ['#26222e', '#805a38', '#966e46', '#ac8455', '#c19a64'];
// A year is at most 54 Monday-first weeks (a leap year that starts on a Sunday): 54 columns of
// 17 px fit the 960 px between the margins.
const calendar = { labels: 226, top: 256, pitch: 17, cell: 14 } as const;
const figures = { top: 430, gap: 30, bottom: 590 } as const;
const shortMonth = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'short' });

/**
 * A year page's card: the year and a muted line saying once what the figures cover, the shipping
 * calendar as one row of weeks with the months above, and up to three figures under it. The
 * calendar opens on the week of the first month the page shows (ADR 0041), and an unread month
 * says so under its name. Only days with a record are drawn, so the image depends on the history
 * alone and not on the day it was built: a fixtures build draws the same card every day of the
 * year. A series with nothing to draw is a line instead of the calendar, as on the page.
 */
export async function renderYearCard(page: YearPage): Promise<Buffer> {
  const { year, shipping } = page;
  const weekday = (date: string) => (new Date(utcDate(date)).getUTCDay() + 6) % 7;
  // The Monday of the week that holds the first shown month's first day.
  const opening = `${shipping.empty === null ? (shipping.months[0]?.month ?? `${year}-01`) : `${year}-01`}-01`;
  const origin = utcDate(opening) - weekday(opening) * dayMs;
  const column = (date: string) =>
    picture.left + Math.floor((utcDate(date) - origin) / dayMs / 7) * calendar.pitch;
  const line = `${site.name} · The year${page.figureScope === '' ? '' : ` ${page.figureScope}`}`;
  const layers: OverlayOptions[] = [
    {
      input: (await pango(titled(year, 72, line, 28, 'serif'), textBox.width)).data,
      left: picture.left,
      top: picture.top,
    },
  ];
  if (shipping.empty !== null) {
    layers.push({
      input: (
        await pango(
          `<span font="min7 Serif 28" foreground="${muted}">${markup(shipping.empty)}</span>`,
          textBox.width
        )
      ).data,
      left: picture.left,
      top: calendar.top,
    });
  } else {
    const squares = shipping.months
      .flatMap((month) => month.cells ?? [])
      .filter((cell) => cell.level !== null)
      .map((cell) => {
        const x = column(cell.date) - picture.left;
        const y = weekday(cell.date) * calendar.pitch;
        return `<rect x="${x}" y="${y}" width="${calendar.cell}" height="${calendar.cell}" rx="2" fill="${heat[cell.level ?? 0]}"/>`;
      });
    layers.push({
      input: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${picture.width}" height="${7 * calendar.pitch}">${squares.join('')}</svg>`
      ),
      left: picture.left,
      top: calendar.top,
    });
    // The shown months up to the last with a record or an unread one, so the labels, like the
    // squares, do not grow with the build date.
    const known = shipping.months.findLastIndex(
      ({ cells }) => cells === null || cells.some((cell) => cell.level !== null)
    );
    for (const { month, cells } of shipping.months.slice(0, known + 1)) {
      const date = `${month}-01`;
      // sharp crops text to its ink: a transparent `Ég` gives every label the same top and bottom.
      const label = await pango(
        `<span font="min7 Serif 20" foreground="${muted}">${shortMonth.format(utcDate(date))}<span alpha="1">Ég</span></span>`,
        80
      );
      layers.push({ input: label.data, left: column(date), top: calendar.labels });
      if (cells === null) {
        const unread = await pango(
          `<span font="min7 Serif 18" foreground="${muted}">unread</span>`,
          80
        );
        layers.push({ input: unread.data, left: column(date), top: calendar.top + 2 });
      }
    }
  }
  const width = (textBox.width - (page.figures.length - 1) * figures.gap) / page.figures.length;
  for (const [index, figure] of page.figures.entries()) {
    const block = await pango(
      `<span font="min7 Serif Semi-Bold 56" foreground="${text}">${markup(figure.value)}</span>\n<span font="min7 Serif 22" foreground="${muted}">${markup(figure.label)}</span>`,
      Math.floor(width)
    );
    if (figures.top + block.info.height > figures.bottom) {
      throw new Error(`og-card: "${figure.label}" does not fit the year card`);
    }
    layers.push({
      input: block.data,
      left: picture.left + Math.round(index * (width + figures.gap)),
      top: figures.top,
    });
  }
  return sharp({ create: { ...ogSize, channels: 3, background: ground } })
    .composite(layers)
    .png({ palette: true, compressionLevel: 9, effort: 10 })
    .toBuffer();
}
