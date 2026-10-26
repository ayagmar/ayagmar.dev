/**
 * Per-post art (ADR 0027): a small picture above a post's title, drawn at build time as inline
 * SVG from the post's `art` frontmatter. The same slug, kind, seed and palette always give the
 * same bytes, and every colour comes from the room's palette, so each piece belongs to the
 * room. Only arithmetic that is exact in IEEE doubles is used (no Math.sin and friends), so no
 * JavaScript engine can draw it differently.
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

/** Ramps of room colours, dark to light, by the room's materials (indexes into roomPalette). */
export const artPalettes = {
  night: [0, 2, 4, 6, 37],
  lamp: [14, 9, 11, 12, 13],
  screen: [19, 20, 21, 22, 23],
  zellige: [2, 31, 21, 34, 26],
  wood: [14, 15, 16, 17, 18],
} as const;

export const artKinds = ['ascii', 'dither', 'pattern'] as const;

export interface Art {
  kind: (typeof artKinds)[number];
  seed: number;
  palette: keyof typeof artPalettes;
}

/** FNV-1a, 32 bits. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** mulberry32: a small seeded generator of numbers in [0, 1). */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value noise on a `cols` by `rows` lattice, sampled at (x, y) in lattice units. */
function noise(next: () => number, cols: number, rows: number) {
  const lattice = Array.from({ length: (cols + 1) * (rows + 1) }, next);
  const at = (i: number, j: number) => lattice[j * (cols + 1) + i] ?? 0;
  const smooth = (f: number) => f * f * (3 - 2 * f);
  return (x: number, y: number) => {
    const i = Math.min(Math.floor(x), cols - 1);
    const j = Math.min(Math.floor(y), rows - 1);
    const fx = smooth(x - i);
    const fy = smooth(y - j);
    const top = at(i, j) + (at(i + 1, j) - at(i, j)) * fx;
    const bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fx;
    return top + (bottom - top) * fy;
  };
}

// The 8x8 Bayer matrix of scripts/scene.py.
const bayer = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
];

/** A field over a `width` by `height` grid in [0, 1]: two octaves of noise over a slope. */
function field(next: () => number, width: number, height: number) {
  const low = noise(next, 4, 2);
  const high = noise(next, 12, 4);
  const slope = next() < 0.5 ? 1 : -1;
  return (x: number, y: number) => {
    const u = x / width;
    const v = y / height;
    const value =
      0.5 +
      0.55 * (low(u * 4, v * 2) - 0.5) +
      0.3 * (high(u * 12, v * 4) - 0.5) +
      0.3 * slope * (0.5 - v);
    return Math.min(1, Math.max(0, value));
  };
}

/** Rows of colour indexes as one stroked path per colour, skipping the background colour. */
function runs(grid: number[][], ramp: readonly number[]): string {
  const paths = new Map<number, string>();
  grid.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const level = row[x] ?? 0;
      let end = x + 1;
      while (end < row.length && row[end] === level) end++;
      if (level !== 0) paths.set(level, `${paths.get(level) ?? ''}M${x} ${y}.5h${end - x}`);
      x = end;
    }
  });
  return [...paths.keys()]
    .sort((a, b) => a - b)
    .map((level) => `<path stroke="${hex(ramp[level] ?? 0)}" d="${paths.get(level)}"/>`)
    .join('');
}

const svg = (kind: string, width: number, height: number, ramp: readonly number[], body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" class="art art-${kind}" viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false" shape-rendering="crispEdges"><rect width="${width}" height="${height}" fill="${hex(ramp[0] ?? 0)}"/>${body}</svg>`;

/** An ordered (Bayer 8x8) dither of a noise field onto the palette ramp. */
function dither(next: () => number, ramp: readonly number[]): string {
  const [width, height] = [96, 32];
  const value = field(next, width, height);
  const steps = ramp.length - 1;
  const grid = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => {
      const threshold = ((bayer[y % 8]?.[x % 8] ?? 0) + 0.5) / 64;
      return Math.min(steps, Math.floor(value(x, y) * steps + threshold));
    })
  );
  return svg('dither', width, height, ramp, runs(grid, ramp));
}

/** A zellige-like tile, symmetric across both axes and the diagonal, repeated. */
function pattern(next: () => number, ramp: readonly number[], id: string): string {
  const size = 8;
  const cells = new Map<string, number>();
  const tile = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => {
      const a = Math.min(x, size - 1 - x);
      const b = Math.min(y, size - 1 - y);
      const key = `${Math.max(a, b)},${Math.min(a, b)}`;
      if (!cells.has(key)) cells.set(key, Math.floor(next() * ramp.length));
      return cells.get(key) ?? 0;
    })
  );
  const body = `<defs><pattern id="${id}" width="${size}" height="${size}" patternUnits="userSpaceOnUse">${runs(tile, ramp)}</pattern></defs><rect width="96" height="32" fill="url(#${id})"/>`;
  return svg('pattern', 96, 32, ramp, body);
}

/** The noise field as characters, darker to lighter glyphs, coloured by the ramp. */
function ascii(next: () => number, ramp: readonly number[]): string {
  const [cols, rows, cellWidth, cellHeight] = [48, 8, 6, 12];
  const glyphs = ' .:-=+*#%@';
  const value = field(next, cols, rows);
  const lines = Array.from({ length: rows }, (_, y) => {
    let line = '';
    let x = 0;
    while (x < cols) {
      const glyph = (at: number) =>
        Math.min(glyphs.length - 1, Math.floor(value(at, y) * glyphs.length));
      const color = (at: number) =>
        Math.ceil((glyph(at) * (ramp.length - 1)) / (glyphs.length - 1));
      let end = x + 1;
      while (end < cols && color(end) === color(x)) end++;
      let text = '';
      for (let at = x; at < end; at++) text += glyphs[glyph(at)];
      line += `<tspan fill="${hex(ramp[color(x)] ?? 0)}">${text}</tspan>`;
      x = end;
    }
    return `<text x="0" y="${y * cellHeight + 9}" textLength="${cols * cellWidth}" lengthAdjust="spacingAndGlyphs">${line}</text>`;
  });
  return svg('ascii', cols * cellWidth, rows * cellHeight, ramp, lines.join(''));
}

/** The post's art as an SVG string, for the `art` slot of PostHeader. */
export function renderArt(slug: string, art: Art): string {
  const next = random(hash(`${slug}:${art.seed}`));
  const ramp = artPalettes[art.palette];
  if (art.kind === 'dither') return dither(next, ramp);
  if (art.kind === 'pattern') return pattern(next, ramp, `art-${slug}`);
  return ascii(next, ramp);
}
