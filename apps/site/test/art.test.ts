import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Art, artKinds, artPalettes, renderArt, roomPalette } from '../src/lib/art.ts';

const hex = ([r, g, b]: readonly number[]) =>
  `#${[r, g, b].map((c) => (c ?? 0).toString(16).padStart(2, '0')).join('')}`;

const every = artKinds.flatMap((kind) =>
  Object.keys(artPalettes).map((palette) => ({ kind, palette }) as Pick<Art, 'kind' | 'palette'>)
);

describe('post art', () => {
  // Golden files: catches any change to the drawing, including one that only shows on another
  // machine or Node version. Regenerate with `vitest run -u` when the change is intended.
  it.each(artKinds)('draws the %s kind exactly as before', async (kind) => {
    const art = renderArt('golden-post', { kind, seed: 7, palette: 'night' });
    await expect(art).toMatchFileSnapshot(`golden/art-${kind}.svg`);
  });

  it.each(artKinds)('draws a different %s for a different seed or post', (kind) => {
    const art = (slug: string, seed: number) => renderArt(slug, { kind, seed, palette: 'lamp' });
    expect(art('a-post', 1)).toBe(art('a-post', 1));
    expect(art('a-post', 2)).not.toBe(art('a-post', 1));
    expect(art('another-post', 1)).not.toBe(art('a-post', 1));
  });

  // Catches a colour that is not the room's, in any kind with any palette.
  it('uses only colours from the room palette', () => {
    const room = new Set(roomPalette.map(hex));
    for (const { kind, palette } of every) {
      const used = renderArt('any-post', { kind, seed: 3, palette }).match(/#[0-9a-f]{6}/g) ?? [];
      expect(used.length, `${kind} ${palette}`).toBeGreaterThan(1);
      expect(
        used.filter((color) => !room.has(color)),
        `${kind} ${palette}`
      ).toEqual([]);
    }
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
});
