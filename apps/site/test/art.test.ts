import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  artProblem,
  lattice,
  mapProblem,
  renderArt,
  renderMap,
  roomObjects,
  roomPalette,
} from '../src/lib/art.ts';
import { moonColour } from '../src/lib/sky.ts';

const hex = ([r, g, b]: readonly number[]) =>
  `#${[r, g, b].map((c) => (c ?? 0).toString(16).padStart(2, '0')).join('')}`;

const repo = join(import.meta.dirname, '..', '..', '..');
const path = (svg: string, tone: string) =>
  new RegExp(`<path class="${tone}"[^>]* d="([^"]*)"`).exec(svg)?.[1];

describe('post art', () => {
  // Golden files: catches any change to the drawing, including one that only shows on another
  // machine or Node version. Regenerate with `vitest run -u` when the change is intended.
  it.each(['notebook', 'ephemeral-runners.art.txt', 'record'])(
    'draws %s exactly as before',
    async (art) => {
      await expect(renderArt(art)).toMatchFileSnapshot(`golden/art-${art.split('.')[0]}.svg`);
    }
  );

  // Catches a named object whose map was never committed, or one that breaks the map rules.
  it.each(roomObjects)('has a valid map for the %s', (name) => {
    expect(artProblem(name)).toBeUndefined();
    expect(renderArt(name)).toContain('class="bright"');
  });

  // Catches a colour that is not the room's, on any object or in the page's day tones.
  it('uses only colours from the room palette', () => {
    const room = new Set(roomPalette.map(hex));
    const css = readFileSync(join(import.meta.dirname, '..', 'src/styles/base.css'), 'utf8');
    const block = css.slice(css.indexOf('.art-dots .ground'), css.indexOf('.prose {'));
    const used = [
      ...roomObjects.flatMap((name) => renderArt(name).match(/#[0-9a-f]{6}/g) ?? []),
      ...(block.match(/#[0-9a-f]{6}/g) ?? []),
    ];
    expect(used.length).toBeGreaterThan(6);
    expect(used.filter((color) => !room.has(color))).toEqual([]);
  });

  // Catches the art palette drifting from the scene's: both are the room's 41 colours.
  it('has the same palette as scripts/scene.py', () => {
    const scene = readFileSync(join(import.meta.dirname, '..', 'scripts', 'scene.py'), 'utf8');
    const block = scene.slice(scene.indexOf('    PAL = ['), scene.indexOf('    if DAY or sky'));
    const colors = [...block.matchAll(/\((\d+), (\d+), (\d+)\)/g)].map(([, r, g, b]) =>
      [r, g, b].map(Number)
    );
    expect(colors).toHaveLength(41);
    expect(colors).toEqual(roomPalette.map((color) => [...color]));
  });

  // Catches a colour in room.css or the moon's leaving the palette, which only a test can hold:
  // CSS cannot import it, and the scene around them would stop matching.
  it('holds the room CSS and the moon to the palette', () => {
    const css = readFileSync(join(import.meta.dirname, '..', 'src/styles/room.css'), 'utf8');
    const colours = [...css.matchAll(/--room-[\w-]+: (#[0-9a-f]{6});/g)].map(([, value]) => value);
    expect(colours).toHaveLength(7);
    const room = roomPalette.map(hex);
    expect([...colours, moonColour].filter((colour) => !room.includes(colour as string))).toEqual(
      []
    );
  });

  // Catches a map published with no record of where its image came from.
  it('records the source of every map beside a post', () => {
    const dir = join(repo, 'content/writing');
    const sources = readFileSync(join(dir, 'art-sources.txt'), 'utf8');
    const maps = readdirSync(dir).filter((name) => name.endsWith('.art.txt'));
    expect(maps.filter((name) => !sources.includes(`${name}\n`))).toEqual([]);
  });
});

describe('text maps', () => {
  // Catches the lattice arithmetic: a lone dot belongs in the middle cell, with no other tone.
  it('puts a map of one dot in the middle of the lattice', () => {
    const svg = renderMap('#\n');
    expect(path(svg, 'bright')).toBe('M715 232h1');
    expect(svg).not.toContain('class="dim"');
    expect(svg).not.toContain('class="accent"');
  });

  // Catches a dot lost or doubled at the end of a run, where the row runs out.
  it('ends a run at the edge of the row on its last dot', () => {
    const svg = renderMap(`${' '.repeat(lattice.cols - 2)}##`);
    expect(path(svg, 'bright')).toBe('M1425 232h11');
  });

  // Catches tones swapped, runs joined across a tone change, or dim dots not dropped.
  it('splits a row of mixed tones into a run per tone', () => {
    const svg = renderMap('##.+ #');
    expect(path(svg, 'bright')).toBe('M695 232h11M745 232h1');
    expect(path(svg, 'dim')).toBe('M715 234h1');
    expect(path(svg, 'accent')).toBe('M725 232h1');
  });

  // Catches an off-by-one at the limits: the corners of the largest map stay inside the picture.
  it('draws the widest and tallest map from corner to corner', () => {
    const row = '#'.repeat(lattice.cols);
    const map = `${Array.from({ length: lattice.rows }, () => row).join('\n')}\n`;
    expect(mapProblem(map)).toBeUndefined();
    const d = path(renderMap(map), 'bright') ?? '';
    expect(d.startsWith('M5 8h1431')).toBe(true);
    expect(d.endsWith('M5 472h1431')).toBe(true);
  });

  // Catches a broken map reaching the build: each of these must stop it, saying what is wrong.
  it.each([
    ['empty', '', 'has no dots'],
    ['blank', '   \n   \n', 'has no dots'],
    ['other characters', '##\n#x\n', 'row 2 has "x"; a map uses only #, ., + and spaces'],
    ['Windows line ends', '##\r\n##\r\n', 'row 1 has "\\r"; a map uses only #, ., + and spaces'],
    ['ragged rows', '###\n##\n', 'row 2 is 2 wide and row 1 is 3; pad rows with spaces'],
    ['too wide', `${'#'.repeat(lattice.cols + 1)}\n`, 'row 1 is 145 wide, 144 at most'],
    ['too tall', '#\n'.repeat(lattice.rows + 1), 'has 31 rows, 30 at most'],
  ])('rejects a map that is %s', (_case, text, expected) => {
    expect(mapProblem(text)).toBe(expected);
  });

  // Catches a bad file passing because only the name was checked, or an error that hides the file.
  it('names the file when a map beside a post is broken', () => {
    expect(artProblem('a-post.art.txt', () => '#x\n')).toBe(
      'content/writing/a-post.art.txt row 1 has "x"; a map uses only #, ., + and spaces'
    );
    expect(artProblem('a-post.art.txt', () => '#.\n')).toBeUndefined();
  });
});
