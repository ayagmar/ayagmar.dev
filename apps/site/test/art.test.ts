import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lattice, mapProblem, renderMap, roomObjects, roomPalette } from '../src/lib/art.ts';
import { artProblem, mapsIn, postArtErrors, renderArt } from '../src/lib/art-files.ts';
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

  // Catches a colour that is not the room's, on any object or in the page's tones, and a card
  // that drifts from the page: the SVG's attributes are the night half of the tokens.
  it('uses only colours from the room palette, the same on the card as on the page', () => {
    const room = new Set(roomPalette.map(hex));
    const css = readFileSync(join(import.meta.dirname, '..', 'src/styles/base.css'), 'utf8');
    const tokens = [...css.matchAll(/--art-(\w+): light-dark\((#[0-9a-f]{6}), (#[0-9a-f]{6})\);/g)];
    expect(tokens.map(([, tone]) => tone)).toEqual(['bright', 'dim', 'accent']);
    const objects = roomObjects.flatMap((name) => renderArt(name).match(/#[0-9a-f]{6}/g) ?? []);
    const used = [...objects, ...tokens.flatMap(([, , day, night]) => [day, night])];
    expect(used.filter((color) => !room.has(color as string))).toEqual([]);
    const card = renderMap('#.+\n');
    const stroke = (tone: unknown) =>
      new RegExp(`class="${tone}" stroke="(#[0-9a-f]{6})"`).exec(card)?.[1];
    expect(tokens.map(([, tone]) => stroke(tone))).toEqual(tokens.map(([, , , night]) => night));
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

  // Catches a map published with no record of its image, a record with no link or licence, and a
  // record left behind by a deleted map.
  it('records the source and licence of every map beside a post', () => {
    const dir = join(repo, 'content/writing');
    const records = readFileSync(join(dir, 'art-sources.txt'), 'utf8')
      .trim()
      .split('\n\n')
      .slice(1);
    const maps = readdirSync(dir).filter((name) => name.endsWith('.art.txt'));
    expect(records.map((record) => record.split('\n')[0]).sort()).toEqual(maps.sort());
    const sourced = (record: string) =>
      /own work/i.test(record) ||
      (/https:\/\/\S/.test(record) && /CC0|public domain/i.test(record));
    expect(records.filter((record) => !sourced(record))).toEqual([]);
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
    ['tabs', '#\t#\n', 'row 1 has "\\t"; a map uses only #, ., + and spaces'],
    ['opened by a BOM', '\uFEFF##\n', 'row 1 has U+FEFF; a map uses only #, ., + and spaces'],
    [
      'spaced with a no-break space',
      '#\u00A0#\n',
      'row 1 has U+00A0; a map uses only #, ., + and spaces',
    ],
    ['not ASCII', '#\u{1F40E}\n', 'row 1 has U+1F40E; a map uses only #, ., + and spaces'],
    ['ragged rows', '###\n##\n', 'row 2 is 2 wide and row 1 is 3; pad rows with spaces'],
    ['too wide', `${'#'.repeat(lattice.cols + 1)}\n`, 'row 1 is 145 wide, 144 at most'],
    ['too tall', '#\n'.repeat(lattice.rows + 1), 'has 31 rows, 30 at most'],
  ])('rejects a map that is %s', (_case, text, expected) => {
    expect(mapProblem(text)).toBe(expected);
  });

  // Catches a bad file passing because only the name was checked, or an error that hides the file.
  it('names the file when a map beside a post is broken', () => {
    expect(artProblem('a-post.art.txt', () => ({ text: '#x\n' }))).toBe(
      'content/writing/a-post.art.txt row 1 has "x"; a map uses only #, ., + and spaces'
    );
    expect(artProblem('a-post.art.txt', () => ({ text: '#.\n' }))).toBeUndefined();
  });

  // Catches the two namespaces running together: `lamp.art.txt` is a post's map, never the object.
  it('keeps a map called lamp.art.txt apart from the lamp', () => {
    const read = () => ({ text: '#\n' });
    expect(renderArt('lamp.art.txt', read)).toBe(renderMap('#\n'));
    expect(renderArt('lamp', read)).not.toBe(renderMap('#\n'));
    expect(artProblem('lamp.art.txt', () => ({ problem: 'does not exist' }))).toBe(
      'content/writing/lamp.art.txt does not exist'
    );
  });
});

describe('maps on disk', () => {
  let root: string;
  let dir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'art-'));
    dir = join(root, 'writing');
    mkdirSync(dir);
  });
  afterEach(() => {
    chmodSync(dir, 0o755);
    rmSync(root, { recursive: true });
  });

  // Catches a symlink whose target renders from outside the repository: valid map, valid name.
  it('refuses a symlink to a valid map outside the folder', () => {
    writeFileSync(join(root, 'outside.txt'), '#\n');
    symlinkSync(join(root, 'outside.txt'), join(dir, 'custom.art.txt'));
    expect(artProblem('custom.art.txt', mapsIn(dir))).toBe(
      'content/writing/custom.art.txt must be a plain file, not a symlink or a directory'
    );
    expect(() => renderArt('custom.art.txt', mapsIn(dir))).toThrow('must be a plain file');
  });

  // Catches a raw EISDIR from the loader, which would not name the map.
  it('refuses a directory with a map name', () => {
    mkdirSync(join(dir, 'custom.art.txt'));
    expect(artProblem('custom.art.txt', mapsIn(dir))).toBe(
      'content/writing/custom.art.txt must be a plain file, not a symlink or a directory'
    );
  });

  // Catches a raw EACCES from the loader, which would not name the map.
  it.skipIf(process.getuid?.() === 0)('reports a folder it may not read', () => {
    chmodSync(dir, 0o000);
    expect(artProblem('custom.art.txt', mapsIn(dir))).toMatch(
      /^content\/writing\/custom\.art\.txt cannot be read: EACCES/
    );
  });

  // Catches a map changed alone, which the content cache does not notice: both posts keep their
  // stored entry, the schema does not run, and nothing renders the draft to trip over it.
  it('finds a deleted and a corrupted map on stored entries, drafts included', () => {
    const posts = [
      { id: 'a-draft', art: 'a-draft.art.txt' },
      { id: 'a-post', art: 'a-post.art.txt' },
      { id: 'fine', art: 'fine.art.txt' },
      { id: 'no-art', art: undefined },
    ];
    writeFileSync(join(dir, 'fine.art.txt'), '#\n');
    writeFileSync(join(dir, 'a-post.art.txt'), '#x\n');
    expect(postArtErrors(posts, mapsIn(dir))).toEqual([
      'content/writing/a-draft.md: art content/writing/a-draft.art.txt does not exist',
      'content/writing/a-post.md: art content/writing/a-post.art.txt row 1 has "x"; a map uses only #, ., + and spaces',
    ]);
  });

  // Catches an entry stored before the object form was retired, which no schema run will see.
  it('names the post and the new form for a stored old value', () => {
    const old = { kind: 'dither', palette: 'night', seed: 2 };
    expect(postArtErrors([{ id: 'old', art: old }])).toEqual([
      'content/writing/old.md: art takes one name, not { kind, palette, seed }: a room object, as in "art: record", or a map beside the post, as in "art: my-post.art.txt"',
    ]);
  });
});
