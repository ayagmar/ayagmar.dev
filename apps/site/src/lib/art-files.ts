import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { artNameProblem, isPostMap, mapProblem, renderMap } from './art.ts';

/** The writing collection's base; every build and test runs in apps/site. */
export const writingBase = '../../content/writing';

/** A map's text, or why there is none. */
type MapFile = { text: string } | { problem: string };

// Bundled, so the named objects are part of the build.
const objectMaps: Record<string, string> = import.meta.glob('../art/*.txt', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/**
 * A reader of the maps in `dir`. A symlink is refused, not followed: its target could sit outside
 * the repository, and the same checkout would then draw differently on another machine.
 */
export const mapsIn =
  (dir: string) =>
  (file: string): MapFile => {
    const path = resolve(dir, file);
    try {
      const stat = lstatSync(path, { throwIfNoEntry: false });
      if (stat === undefined) return { problem: 'does not exist' };
      if (!stat.isFile()) return { problem: 'must be a plain file, not a symlink or a directory' };
      return { text: readFileSync(path, 'utf8') };
    } catch (error) {
      return { problem: `cannot be read: ${(error as Error).message}` };
    }
  };

const beside = mapsIn(writingBase);

/** The map a valid name stands for, under the name a message should use. */
function mapOf(art: string, read: typeof beside) {
  if (isPostMap(art)) return { file: `content/writing/${art}`, map: read(art) };
  const text = objectMaps[`../art/${art}.txt`];
  return {
    file: `src/art/${art}.txt`,
    map: text === undefined ? { problem: 'does not exist' } : { text },
  };
}

/** What is wrong with a post's `art` value or its map, or undefined. */
export function artProblem(art: unknown, read = beside): string | undefined {
  const name = artNameProblem(art);
  if (name !== undefined || typeof art !== 'string') return name;
  const { file, map } = mapOf(art, read);
  const problem = 'problem' in map ? map.problem : mapProblem(map.text);
  return problem === undefined ? undefined : `${file} ${problem}`;
}

/**
 * One line for each post whose art is broken, drafts included. The content cache keeps an entry
 * whose Markdown has not changed, schema and all, so only a check over the stored entries sees a
 * map that changed alone, and a draft is never rendered to trip over it.
 */
export function postArtErrors(
  posts: readonly { id: string; art: unknown }[],
  read = beside
): string[] {
  return posts.flatMap(({ id, art }) => {
    const problem = art === undefined ? undefined : artProblem(art, read);
    return problem === undefined ? [] : [`content/writing/${id}.md: art ${problem}`];
  });
}

/** The post's art as an SVG string, for PostHeader. */
export function renderArt(art: string, read = beside): string {
  const problem = artProblem(art, read);
  if (problem !== undefined) throw new Error(`art: ${problem}`);
  const { map } = mapOf(art, read);
  return renderMap('text' in map ? map.text : '');
}
