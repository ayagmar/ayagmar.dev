import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkCommentSource } from './check-comments.ts';

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
    ].join('\n');
    assert.deepEqual(findings('a.astro', astro), [
      '2: narrates steps ("now we")',
      '4: describes history ("new:")',
      '6: describes history ("previously")',
      '9: filler ("simply")',
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
    ].join('\n');
    assert.deepEqual(findings('a.ts', ts), []);
    assert.deepEqual(findings('a.svelte', '<p>Simply put, note that this is text.</p>\n'), []);
  });
});
