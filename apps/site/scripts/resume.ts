// Writes resume/build/resume.pdf from content/about.json with Typst (`just resume`). The data is
// validated first, so a bad field fails with a message naming it instead of a Typst error.
// Usage: TYPST=<path to typst> node scripts/resume.ts
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generatedResume, readAbout, repoRoot } from './ship-resume.ts';

/** Compiles `<root>/resume/resume.typ`, which reads `<root>/content/about.json`, into `output`. */
export function compileResume(root: string, output: string): void {
  mkdirSync(dirname(output), { recursive: true });
  const result = spawnSync(
    process.env.TYPST ?? 'typst',
    [
      'compile',
      '--root',
      root,
      // Only Typst's embedded fonts, so every machine renders the same PDF.
      '--ignore-system-fonts',
      join(root, 'resume', 'resume.typ'),
      output,
    ],
    { encoding: 'utf8' }
  );
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(`resume: typst failed\n${result.stderr}`);
}

if (import.meta.main) {
  readAbout();
  compileResume(repoRoot, generatedResume);
  console.log(`resume: wrote ${generatedResume}`);
}
