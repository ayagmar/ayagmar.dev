// Runs after `astro build`: copies the resume PDF into dist when content/about.json says
// `resume.published: true`. A hand-made resume/override.pdf ships instead of the generated one.
// While unpublished nothing is copied, so /resume.pdf is a 404.
// Usage: node scripts/ship-resume.ts [dist] [repo-root]
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type About, parseAbout } from '../src/data/about.ts';

export const repoRoot = join(import.meta.dirname, '..', '..', '..');

/** Where the about data, the generated resume and the override live under a repo root. */
const resumeFiles = (root: string) => ({
  about: join(root, 'content', 'about.json'),
  generated: join(root, 'resume', 'build', 'resume.pdf'),
  override: join(root, 'resume', 'override.pdf'),
});

export const { about: aboutFile, generated: generatedResume } = resumeFiles(repoRoot);

/** content/about.json, validated. Pages read it through the `about` content collection. */
export const readAbout = (file = aboutFile): About =>
  parseAbout(JSON.parse(readFileSync(file, 'utf8')));

/** Copies the resume into `dist/resume.pdf` when published. Returns the file it shipped, if any. */
function shipResume(root: string, dist: string): string | undefined {
  const files = resumeFiles(root);
  if (!readAbout(files.about).resume.published) return undefined;
  const source = existsSync(files.override) ? files.override : files.generated;
  if (!existsSync(source)) {
    throw new Error(`ship-resume: ${source} does not exist; run \`just resume\` first`);
  }
  copyFileSync(source, join(dist, 'resume.pdf'));
  return source;
}

if (import.meta.main) {
  const dist = process.argv[2] ?? join(import.meta.dirname, '..', 'dist');
  const shipped = shipResume(process.argv[3] ?? repoRoot, dist);
  console.log(
    shipped === undefined
      ? 'ship-resume: resume.published is false, not shipping a PDF'
      : `ship-resume: shipped ${shipped} as resume.pdf`
  );
}
