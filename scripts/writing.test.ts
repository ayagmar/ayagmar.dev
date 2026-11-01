// The writing flow through its CLI, in a temporary clone of a temporary origin, with fake `just`
// (the site build) and `gh` on PATH. Nothing here starts a dev server or opens a browser.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

const script = join(import.meta.dirname, 'writing.ts');
let dir: string;
let repo: string;
let origin: string;

const env = (extra: Record<string, string> = {}) => ({
  PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}`,
  HOME: dir,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
  ...extra,
});
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, env: env(), encoding: 'utf8' }).trim();
const cli = (args: string[], extra: Record<string, string> = {}) => {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repo,
    env: env(extra),
    encoding: 'utf8',
  });
  return { code: result.status, out: result.stdout + result.stderr };
};
const read = (path: string) => readFileSync(join(repo, path), 'utf8');
const today = new Date().toISOString().slice(0, 10);

const draftPost = `---
title: "Cache reads"
date: 2026-10-01
updated: 2026-10-20
summary: 'One sentence.'
tags: []
draft: true
---

Body with draft: true in it.
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'min7-writing-'));
  origin = join(dir, 'origin.git');
  repo = join(dir, 'repo');
  mkdirSync(join(dir, 'bin'));
  // The site build passes unless FAKE_BUILD_FAILS is set; gh prints the URL of a new PR.
  writeFileSync(join(dir, 'bin', 'just'), '#!/bin/sh\n[ -z "$FAKE_BUILD_FAILS" ]\n');
  writeFileSync(join(dir, 'bin', 'gh'), '#!/bin/sh\necho https://github.com/ayagmar/min7/pull/7\n');
  chmodSync(join(dir, 'bin', 'just'), 0o755);
  chmodSync(join(dir, 'bin', 'gh'), 0o755);
  git(dir, 'init', '-q', '--bare', '-b', 'main', origin);
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'remote', 'add', 'origin', origin);
  for (const sub of ['writing', 'til']) {
    mkdirSync(join(repo, 'content', sub), { recursive: true });
    writeFileSync(join(repo, 'content', sub, '.keep'), '');
  }
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  git(repo, 'push', '-q', '-u', 'origin', 'main');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('new drafts', () => {
  it('writes a post with a summary and a note without one, both drafts dated today', () => {
    assert.equal(cli(['new', 'post', 'Ça marche: Niri & tmux!', '--no-open']).code, 0);
    assert.equal(
      read('content/writing/ca-marche-niri-tmux.md'),
      `---\ntitle: "Ça marche: Niri & tmux!"\ndate: ${today}\nsummary: 'TODO: one sentence on what this post is about.'\ntags: []\ndraft: true\n---\n\nWrite here.\n`
    );
    assert.equal(cli(['new', 'til', 'A brace group', '--no-open']).code, 0);
    assert.equal(
      read('content/til/a-brace-group.md'),
      `---\ntitle: "A brace group"\ndate: ${today}\ntags: []\ndraft: true\n---\n\nWrite here.\n`
    );
  });

  it('never overwrites an existing file', () => {
    writeFileSync(join(repo, 'content/til/taken.md'), 'mine\n');
    const { code, out } = cli(['new', 'til', 'Taken', '--no-open']);
    assert.equal(code, 1);
    assert.match(out, /already exists/);
    assert.equal(read('content/til/taken.md'), 'mine\n');
  });
});

describe('publish', () => {
  beforeEach(() => writeFileSync(join(repo, 'content/writing/cache-reads.md'), draftPost));

  const states: [string, () => void][] = [
    ['a new draft', () => {}],
    [
      'a committed draft edited since',
      () => {
        writeFileSync(
          join(repo, 'content/writing/cache-reads.md'),
          draftPost.replace('Body', 'Old')
        );
        git(repo, 'add', '-A');
        git(repo, 'commit', '-q', '-m', 'draft');
        git(repo, 'push', '-q', 'origin', 'main');
        writeFileSync(join(repo, 'content/writing/cache-reads.md'), draftPost);
      },
    ],
  ];
  for (const [state, arrange] of states)
    it(`publishes ${state} on its own branch: draft false, date today, updated kept, pushed, PR printed`, () => {
      arrange();
      const { code, out } = cli(['publish', 'cache-reads']);
      assert.equal(code, 0, out);
      assert.equal(
        read('content/writing/cache-reads.md'),
        draftPost
          .replace('date: 2026-10-01', `date: ${today}`)
          .replace('draft: true\n---', 'draft: false\n---')
      );
      assert.equal(git(repo, 'branch', '--show-current'), 'content/cache-reads');
      assert.equal(
        git(origin, 'log', '-1', '--format=%s', 'content/cache-reads'),
        'content(writing): publish cache-reads'
      );
      assert.equal(
        git(origin, 'diff', '--name-only', 'main', 'content/cache-reads'),
        'content/writing/cache-reads.md'
      );
      assert.match(out, /https:\/\/github\.com\/ayagmar\/min7\/pull\/7/);
      assert.match(
        out,
        /https:\/\/content-cache-reads-min7-site\.ayagmar\.workers\.dev\/writing\/cache-reads/
      );
    });

  it('a dry run checks and prints the steps but changes nothing', () => {
    const { code, out } = cli(['publish', '--dry-run', 'cache-reads']);
    assert.equal(code, 0, out);
    assert.match(out, /content\(writing\): publish cache-reads/);
    assert.equal(read('content/writing/cache-reads.md'), draftPost);
    assert.equal(git(repo, 'branch', '--show-current'), 'main');
    assert.equal(git(origin, 'branch', '--list', 'content/*'), '');
  });

  it('puts the draft back and makes no branch when the build fails', () => {
    const { code, out } = cli(['publish', 'cache-reads'], { FAKE_BUILD_FAILS: '1' });
    assert.equal(code, 1);
    assert.match(out, /draft again/);
    assert.equal(read('content/writing/cache-reads.md'), draftPost);
    assert.equal(git(repo, 'branch', '--list', 'content/*'), '');
  });

  const refusals: [string, () => void, RegExp][] = [
    [
      'another file is changed',
      () => writeFileSync(join(repo, 'content/til/.keep'), 'x'),
      /Other changes/,
    ],
    [
      'another file is untracked',
      () => writeFileSync(join(repo, 'notes.txt'), 'x'),
      /Other changes/,
    ],
    [
      'HEAD is behind origin/main',
      () => {
        const other = join(dir, 'other');
        git(dir, 'clone', '-q', origin, other);
        git(other, 'commit', '-q', '--allow-empty', '-m', 'newer');
        git(other, 'push', '-q', 'origin', 'main');
      },
      /not origin\/main/,
    ],
    [
      'HEAD is a commit ahead',
      () => git(repo, 'commit', '-q', '--allow-empty', '-m', 'local'),
      /not origin\/main/,
    ],
    [
      'the file is not a draft',
      () =>
        writeFileSync(
          join(repo, 'content/writing/cache-reads.md'),
          draftPost.replace('draft: true\n---', '---')
        ),
      /not a draft/,
    ],
    [
      'the slug is unknown',
      () => rmSync(join(repo, 'content/writing/cache-reads.md')),
      /No post or note/,
    ],
  ];
  for (const [when, arrange, reason] of refusals) {
    it(`refuses when ${when}, changing nothing`, () => {
      arrange();
      const post = join(repo, 'content/writing/cache-reads.md');
      const snapshot = () => (existsSync(post) ? readFileSync(post, 'utf8') : null);
      const before = snapshot();
      const { code, out } = cli(['publish', 'cache-reads']);
      assert.equal(code, 1, out);
      assert.match(out, reason);
      assert.equal(snapshot(), before);
      assert.equal(git(origin, 'branch', '--list', 'content/*'), '');
    });
  }
});
