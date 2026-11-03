import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { checkCommentSource, checkComments } from './check-comments.ts';

const findings = (file: string, source: string) =>
  checkCommentSource(file, source).map(({ line, message }) => `${line}: ${message}`);

describe('check-comments', () => {
  // Catches narration and history comments in each kind of source the check reads.
  it('flags narration, history, filler and untracked TODOs', () => {
    const ts = [
      '// First we read the file.',
      'const a = 1; // used to be 2',
      '/**',
      ' * This function reads it.',
      ' * Note that it throws.',
      ' */',
      'function f() {',
      '  // TODO: tidy',
      '}',
    ].join('\n');
    assert.deepEqual(findings('a.ts', ts), [
      '1: narrates steps ("first we")',
      '2: describes history ("used to")',
      '4: restates the code ("this function")',
      '5: filler ("note that")',
      '8: TODO without an issue number or URL',
    ]);
    const astro = [
      '---',
      '// Now we load the posts.',
      '---',
      '<!-- New: the footer -->',
      '<script>',
      '  // Previously this ran on load.',
      '</script>',
      '<style>',
      '  /* Simply a grid. */',
      '</style>',
      '<p>{/* Basically the footer. */}</p>',
      '{',
      '  /* It used to be a list. */',
      '}',
    ].join('\n');
    assert.deepEqual(findings('a.astro', astro), [
      '2: narrates steps ("now we")',
      '4: describes history ("new:")',
      '6: describes history ("previously")',
      '9: filler ("simply")',
      '11: filler ("basically")',
      '13: describes history ("used to")',
    ]);
    assert.deepEqual(findings('b.ts', '// Updated to v2.\n// We used to poll.\n'), [
      '1: describes history ("updated to")',
      '2: describes history ("used to")',
    ]);
  });

  // Catches the check failing ordinary why-comments that share a word with the list, or text
  // in strings and markup, which would push people to reword good comments.
  it('accepts why-comments and non-comment text that share the words', () => {
    const ts = [
      '// Catches a note that ships while it is still a draft.',
      '// The key is used to sign each push; written by this function from a checked answer.',
      '// A delivery that no longer describes the machine is dropped. TODO(#42): batch them.',
      '// FIXME https://github.com/ayagmar/ayagmar.dev/issues/7',
      "const s = '// now we go, TODO: write';",
      'const r = /\\/\\/ simply/;',
      'f(); // read every day new: none are skipped',
      '// The key used to sign each push, and the HMAC secret used to verify the body.',
      '// Keeps the previously stored reading; the row is updated to the latest one.',
    ].join('\n');
    assert.deepEqual(findings('a.ts', ts), []);
    assert.deepEqual(findings('a.svelte', '<p>Simply put, note that this is text.</p>\n'), []);
    // An object literal in the frontmatter is read once, as TypeScript, not again as markup.
    assert.deepEqual(
      findings('b.astro', '---\nconst a = { /* the size */ };\n---\n<p>{a}</p>\n'),
      []
    );
  });

  // Catches a source file an agent wrote but has not staged passing `just check` locally.
  it('reads untracked source files, not ignored ones', () => {
    const root = mkdtempSync(join(tmpdir(), 'min7-check-comments-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: root });
      mkdirSync(join(root, 'scripts'));
      writeFileSync(join(root, '.gitignore'), 'scripts/ignored.ts\n');
      writeFileSync(join(root, 'scripts/new.ts'), '// Simply runs.\n');
      writeFileSync(join(root, 'scripts/ignored.ts'), '// Simply runs.\n');
      assert.deepEqual(checkComments(root), ['scripts/new.ts:1: filler ("simply")']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
