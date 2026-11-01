// The writing flow through its CLI, in a temporary clone of a temporary origin, with fake `just`
// (the site build), `gh`, `xdg-open` and editor on PATH, and a stand-in server on a free port in
// place of the dev server on 4321.
import assert from 'node:assert/strict';
import { type ChildProcess, execFileSync, spawn, spawnSync } from 'node:child_process';
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
import { freePort } from './free-port.ts';

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
const fake = (name: string, body: string) => {
  writeFileSync(join(dir, 'bin', name), `#!/bin/sh\n${body}\n`);
  chmodSync(join(dir, 'bin', name), 0o755);
};
const failingHook = (name: string) => {
  writeFileSync(join(repo, '.git', 'hooks', name), '#!/bin/sh\nexit 1\n');
  chmodSync(join(repo, '.git', 'hooks', name), 0o755);
};
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
  // The site build passes unless FAKE_BUILD_FAILS is set; with FAKE_BUILD_BRANCH it also makes
  // that branch with a commit of its own, as another terminal might while it runs. gh is logged in and opens a PR unless
  // FAKE_PR_FAILS is set. xdg-open notes the URL it was given.
  fake(
    'just',
    '[ -z "$FAKE_BUILD_FAILS" ] || exit 1\n[ -z "$FAKE_BUILD_BRANCH" ] || git branch "$FAKE_BUILD_BRANCH" "$(git commit-tree -p HEAD -m other "HEAD^{tree}")"'
  );
  fake(
    'gh',
    'case "$1 $2" in\n"auth status") ;;\n"pr create") [ -z "$FAKE_PR_FAILS" ] && echo https://github.com/ayagmar/min7/pull/7 ;;\n*) exit 2 ;;\nesac'
  );
  fake('xdg-open', `echo "$1" >> ${JSON.stringify(join(dir, 'opened'))}`);
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

  it('puts the draft, index and branch back when the commit fails', () => {
    failingHook('pre-commit');
    const { code, out } = cli(['publish', 'cache-reads']);
    assert.equal(code, 1, out);
    assert.match(out, /nothing was published/);
    assert.equal(read('content/writing/cache-reads.md'), draftPost);
    assert.equal(git(repo, 'branch', '--show-current'), 'main');
    assert.equal(git(repo, 'branch', '--list', 'content/*'), '');
    assert.equal(git(repo, 'status', '--porcelain'), '?? content/writing/cache-reads.md');
  });

  it('puts back a staged draft exactly as it was staged when the commit fails', () => {
    writeFileSync(
      join(repo, 'content/writing/cache-reads.md'),
      draftPost.replace('Body', 'Staged')
    );
    git(repo, 'add', 'content/writing/cache-reads.md');
    writeFileSync(join(repo, 'content/writing/cache-reads.md'), draftPost);
    const entry = git(repo, 'ls-files', '--stage', 'content/writing/cache-reads.md');
    failingHook('pre-commit');
    const { code, out } = cli(['publish', 'cache-reads']);
    assert.equal(code, 1, out);
    assert.equal(git(repo, 'ls-files', '--stage', 'content/writing/cache-reads.md'), entry);
    assert.equal(read('content/writing/cache-reads.md'), draftPost);
    assert.equal(git(repo, 'status', '--porcelain'), 'AM content/writing/cache-reads.md');
    assert.equal(git(repo, 'branch', '--list', 'content/*'), '');
  });

  it('never deletes a branch something else made while the build ran', () => {
    const { code, out } = cli(['publish', 'cache-reads'], {
      FAKE_BUILD_BRANCH: 'content/cache-reads',
    });
    assert.equal(code, 1, out);
    assert.match(out, /was not touched/);
    assert.equal(git(repo, 'log', '-1', '--format=%s', 'content/cache-reads'), 'other');
    assert.equal(git(repo, 'branch', '--show-current'), 'main');
    assert.equal(read('content/writing/cache-reads.md'), draftPost);
    assert.equal(git(repo, 'status', '--porcelain'), '?? content/writing/cache-reads.md');
  });

  it('keeps the commit and prints how to finish when the push fails', () => {
    failingHook('pre-push');
    const { code, out } = cli(['publish', 'cache-reads']);
    assert.equal(code, 1, out);
    assert.equal(
      git(repo, 'log', '-1', '--format=%s', 'content/cache-reads'),
      'content(writing): publish cache-reads'
    );
    assert.match(
      out,
      /git push -u origin content\/cache-reads\n.*gh pr create --base main --head content\/cache-reads --fill/
    );
    assert.match(out, /content-cache-reads-min7-site\.ayagmar\.workers\.dev/);
  });

  it('prints how to open the PR when gh fails after the push', () => {
    const { code, out } = cli(['publish', 'cache-reads'], { FAKE_PR_FAILS: '1' });
    assert.equal(code, 1, out);
    assert.equal(
      git(origin, 'log', '-1', '--format=%s', 'content/cache-reads'),
      'content(writing): publish cache-reads'
    );
    assert.match(out, /gh pr create --base main --head content\/cache-reads --fill/);
  });

  it('shortens the branch of a long slug so it still gets a Preview', () => {
    // 55 characters. Cut to fit one DNS label, the branch would end in a hyphen.
    const slug = 'why-the-runner-cache-missed-each-read-on-the-new-laptop';
    assert.equal(slug.length, 55);
    rmSync(join(repo, 'content/writing/cache-reads.md'));
    writeFileSync(join(repo, `content/writing/${slug}.md`), draftPost);
    const { code, out } = cli(['publish', slug]);
    assert.equal(code, 0, out);
    assert.equal(
      git(origin, 'branch', '--list', 'content/*'),
      'content/why-the-runner-cache-missed-each-read-on-the'
    );
    const preview = /^Preview.*: (\S+)$/m.exec(out)?.[1] ?? '';
    const label = new URL(preview).hostname.split('.')[0] ?? '';
    assert.equal(preview, `https://${label}.ayagmar.workers.dev/writing/${slug}`);
    assert.ok(label.length <= 63, label);
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
    ['gh is not logged in', () => fake('gh', 'exit 1'), /gh auth login/],
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

describe('an existing server on the dev port', () => {
  let server: ChildProcess | undefined;
  let port: number;

  /** A stand-in for a dev server, answering 200 to every request, run from `cwd` with `env`. */
  async function serve(cwd: string, extra: Record<string, string>) {
    port = await freePort();
    server = spawn(
      process.execPath,
      [
        '-e',
        `require('node:http').createServer((_, res) => res.end('ok')).listen(${port}, 'localhost', () => console.log('ready'))`,
      ],
      { cwd, env: env(extra), stdio: ['ignore', 'pipe', 'inherit'] }
    );
    await new Promise((resolve) => server?.stdout?.once('data', resolve));
  }
  const newPost = (extra: Record<string, string> = {}) =>
    cli(['new', 'post', 'Hello'], { MIN7_TEST_DEV_PORT: String(port), ...extra });
  const opened = () =>
    existsSync(join(dir, 'opened')) ? readFileSync(join(dir, 'opened'), 'utf8') : '';

  afterEach(() => {
    server?.kill();
    server = undefined;
  });

  it('is reused when it is this checkout with drafts shown; the editor gets the file', async () => {
    await serve(join(repo, 'content'), { PUBLIC_SHOW_DRAFTS: '1' });
    mkdirSync(join(dir, 'my editor'));
    const log = join(dir, 'edited');
    writeFileSync(
      join(dir, 'my editor', 'ed'),
      `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(log)}\n`
    );
    chmodSync(join(dir, 'my editor', 'ed'), 0o755);
    const { code, out } = newPost({ EDITOR: `"${dir}/my editor/ed" --wait -n '$(touch x)'` });
    assert.equal(code, 0, out);
    assert.match(out, /Using this checkout's dev server/);
    for (let tries = 0; tries < 40 && !(existsSync(log) && opened()); tries++)
      await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(opened(), `http://localhost:${port}/writing/hello\n`);
    assert.equal(
      readFileSync(log, 'utf8'),
      `-n\n$(touch x)\n${join(repo, 'content/writing/hello.md')}\n`
    );
  });

  const refused: [string, () => [string, Record<string, string>], RegExp][] = [
    ['another checkout', () => [dir, { PUBLIC_SHOW_DRAFTS: '1' }], /taken by something other/],
    ['this checkout without drafts', () => [repo, {}], /hides drafts/],
  ];
  for (const [what, where, reason] of refused) {
    it(`is refused when it is ${what}, opening nothing`, async () => {
      const [cwd, extra] = where();
      await serve(cwd, extra);
      const { code, out } = newPost();
      assert.equal(code, 1, out);
      assert.match(out, reason);
      assert.equal(opened(), '');
    });
  }
});
