import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Per-post art (ADR 0027): a figure above a post's title, drawn at build time as inline SVG from
 * a text map: `#` bright, `.` dim, `+` amber, space empty. A post names one of the room's objects
 * (src/art/) or a map beside it in content/writing. The map is a rectangle of cells on one fixed
 * lattice, and the same map always gives the same bytes: every coordinate is a whole number.
 */

/** The 41 colours of the room, the base palette of scripts/scene.py (a test keeps them equal). */
// biome-ignore format: grouped by material, as in scene.py
export const roomPalette = [
  [8, 9, 18], [13, 15, 30], [20, 23, 46], [30, 34, 68], [44, 50, 92], [66, 74, 128], [100, 112, 170],
  [52, 34, 56], [86, 50, 60], [128, 72, 64], [176, 104, 70], [222, 150, 78], [250, 196, 104], [255, 232, 168],
  [36, 22, 20], [62, 38, 28], [96, 60, 38], [140, 92, 54], [186, 130, 82],
  [14, 46, 44], [24, 84, 74], [46, 140, 110], [110, 214, 170], [190, 246, 220],
  [150, 138, 112], [216, 200, 160], [240, 230, 200],
  [140, 150, 180], [210, 214, 230],
  [120, 38, 40], [190, 64, 56], [40, 70, 130], [80, 120, 190],
  [150, 110, 40], [214, 170, 70], [122, 82, 140], [60, 40, 80],
  [232, 232, 250], [26, 28, 72], [104, 62, 98], [168, 92, 90],
] as const;

const hex = (index: number) =>
  `#${(roomPalette[index] ?? roomPalette[0]).map((c) => c.toString(16).padStart(2, '0')).join('')}`;

export const roomObjects = [
  'lamp',
  'notebook',
  'monitor',
  'record',
  'cat',
  'window',
  'tea',
] as const;

// Bundled, so the named objects are part of the build.
const objectMaps: Record<string, string> = import.meta.glob('../art/*.txt', {
  query: '?raw',
  import: 'default',
  eager: true,
});

// The content collection's base in src/content.config.ts; every build and test runs in apps/site.
const postMap = (file: string) => {
  const path = resolve('../../content/writing', file);
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
};

const pitch = { x: 10, y: 16 };
export const lattice = { cols: 144, rows: 30 };
const size = { width: lattice.cols * pitch.x, height: lattice.rows * pitch.y };

// Night colours as indexes into roomPalette. They are attributes because the link-preview card
// draws the SVG alone; base.css overrides them on the page, where the plate is not painted.
const tones = [
  { char: '.', name: 'dim', color: 6, width: 3.4, drop: 2 },
  { char: '#', name: 'bright', color: 26, width: 7.8, drop: 0 },
  { char: '+', name: 'accent', color: 12, width: 7.8, drop: 0 },
] as const;
const ground = 1;

const rowsOf = (text: string) => text.replace(/\n$/, '').split('\n');

/** What is wrong with a map's text, or undefined. */
export function mapProblem(text: string): string | undefined {
  const rows = rowsOf(text);
  if (rows.length > lattice.rows) return `has ${rows.length} rows, ${lattice.rows} at most`;
  for (const [index, row] of rows.entries()) {
    const stray = /[^#.+ ]/.exec(row)?.[0];
    if (stray !== undefined)
      return `row ${index + 1} has ${JSON.stringify(stray)}; a map uses only #, ., + and spaces`;
    if (row.length > lattice.cols)
      return `row ${index + 1} is ${row.length} wide, ${lattice.cols} at most`;
    if (row.length !== rows[0]?.length)
      return `row ${index + 1} is ${row.length} wide and row 1 is ${rows[0]?.length}; pad rows with spaces`;
  }
  return /[#.+]/.test(text) ? undefined : 'has no dots';
}

const isPostMap = (art: string) => /^[a-z0-9]+(?:-[a-z0-9]+)*\.art\.txt$/.test(art);

/** What is wrong with a post's `art` value, or undefined. `read` finds a map beside a post. */
export function artProblem(art: string, read: (file: string) => string | undefined = postMap) {
  const beside = isPostMap(art);
  if (!beside && !roomObjects.some((name) => name === art))
    return `must be one of ${roomObjects.join(', ')}, or a map beside the post like "my-post.art.txt"`;
  const file = beside ? `content/writing/${art}` : `src/art/${art}.txt`;
  const text = beside ? read(art) : objectMaps[`../art/${art}.txt`];
  if (text === undefined) return `${file} does not exist`;
  const problem = mapProblem(text);
  return problem === undefined ? undefined : `${file} ${problem}`;
}

/** One subpath per run of a tone's dots: a zero-length dash every pitch, round caps. */
function dots(rows: string[], char: string, drop: number): string {
  const left = Math.floor((lattice.cols - (rows[0]?.length ?? 0)) / 2);
  const top = Math.floor((lattice.rows - rows.length) / 2);
  let path = '';
  rows.forEach((row, j) => {
    let i = 0;
    while (i < row.length) {
      if (row[i] !== char) {
        i++;
        continue;
      }
      let end = i;
      while (row[end + 1] === char) end++;
      const x = (left + i) * pitch.x + pitch.x / 2;
      const y = (top + j) * pitch.y + pitch.y / 2 + drop;
      // One unit past the last dot, so rounding along the path cannot lose it.
      path += `M${x} ${y}h${(end - i) * pitch.x + 1}`;
      i = end + 1;
    }
  });
  return path;
}

/** A valid map as SVG. A map smaller than the lattice sits in the middle of it. */
export function renderMap(text: string): string {
  const rows = rowsOf(text);
  const paths = tones
    .map(({ char, name, color, width, drop }) => {
      const d = dots(rows, char, drop);
      return d === ''
        ? ''
        : `<path class="${name}" stroke="${hex(color)}" stroke-width="${width}" d="${d}"/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" class="art-dots" viewBox="0 0 ${size.width} ${size.height}" aria-hidden="true" focusable="false"><rect class="ground" width="${size.width}" height="${size.height}" fill="${hex(ground)}"/><g fill="none" stroke-linecap="round" stroke-dasharray="0 ${pitch.x}">${paths}</g></svg>`;
}

/** The post's art as an SVG string, for PostHeader. */
export function renderArt(art: string): string {
  const problem = artProblem(art);
  if (problem !== undefined) throw new Error(`art: ${problem}`);
  return renderMap((isPostMap(art) ? postMap(art) : objectMaps[`../art/${art}.txt`]) ?? '');
}
