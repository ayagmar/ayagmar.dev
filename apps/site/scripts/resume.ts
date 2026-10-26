// Writes resume/build/resume.pdf from content/about.json with Typst (`just resume`). The data is
// validated first, so a bad field fails with a message naming it instead of a Typst error.
// Usage: TYPST=<path to typst> node scripts/resume.ts
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { generatedResume, readAbout, repoRoot } from './ship-resume.ts';

readAbout();

mkdirSync(join(repoRoot, 'resume', 'build'), { recursive: true });
execFileSync(
  process.env.TYPST ?? 'typst',
  [
    'compile',
    '--root',
    repoRoot,
    // Only Typst's embedded fonts, so every machine renders the same PDF.
    '--ignore-system-fonts',
    join(repoRoot, 'resume', 'resume.typ'),
    generatedResume,
  ],
  { stdio: 'inherit' }
);
console.log(`resume: wrote ${generatedResume}`);
