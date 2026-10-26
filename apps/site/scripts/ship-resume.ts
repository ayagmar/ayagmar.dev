// Runs after `astro build`: copies the resume PDF into dist when content/about.json says
// `resume.published: true`. A hand-made resume/override.pdf ships instead of the generated one.
// While unpublished nothing is copied, so /resume.pdf is a 404.
// Usage: node scripts/ship-resume.ts [dist]
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type About, parseAbout } from '../src/data/about.ts';

export const repoRoot = join(import.meta.dirname, '..', '..', '..');
export const aboutFile = join(repoRoot, 'content', 'about.json');
export const generatedResume = join(repoRoot, 'resume', 'build', 'resume.pdf');
export const overrideResume = join(repoRoot, 'resume', 'override.pdf');

/** content/about.json, validated. Pages read it through the `about` content collection. */
export const readAbout = (): About => parseAbout(JSON.parse(readFileSync(aboutFile, 'utf8')));

interface ShipOptions {
  published: boolean;
  dist: string;
  generated?: string;
  override?: string;
}

/** Copies the resume into `dist/resume.pdf` when published. Returns the file it shipped, if any. */
export function shipResume({
  published,
  dist,
  generated = generatedResume,
  override = overrideResume,
}: ShipOptions): string | undefined {
  if (!published) return undefined;
  const source = existsSync(override) ? override : generated;
  if (!existsSync(source)) {
    throw new Error(`ship-resume: ${source} does not exist; run \`just resume\` first`);
  }
  copyFileSync(source, join(dist, 'resume.pdf'));
  return source;
}

if (import.meta.main) {
  const dist = process.argv[2] ?? join(import.meta.dirname, '..', 'dist');
  const shipped = shipResume({ published: readAbout().resume.published, dist });
  console.log(
    shipped === undefined
      ? 'ship-resume: resume.published is false, not shipping a PDF'
      : `ship-resume: shipped ${shipped} as resume.pdf`
  );
}
