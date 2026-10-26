// The artifact scan as CI runs it (`just scan-artifact`, both scanners), on planted fake
// secrets assembled at run time in a temporary directory.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

const root = join(import.meta.dirname, '..');
const token = ['ghp', 'Q7mZk2vX9pL4wR8tN3bY6cF1dH5jS0aE2gK7'].join('_');
let dist: string;
const scan = () => spawnSync('just', ['scan-artifact', dist], { cwd: root, encoding: 'utf8' });

beforeEach(() => {
  dist = join(mkdtempSync(join(tmpdir(), 'min7-scan-artifact-')), 'dist');
  mkdirSync(dist);
});
afterEach(() => {
  rmSync(join(dist, '..'), { recursive: true, force: true });
});

describe('just scan-artifact', () => {
  it('fails on a token inside a binary file such as a WebAssembly module', () => {
    const wasm = Buffer.concat([
      Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
      Buffer.from(`\x00\x0btoken-data\x00${token}\x00`, 'latin1'),
    ]);
    writeFileSync(join(dist, 'search.wasm'), wasm);
    const result = scan();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /search\.wasm:\d+: github-token/);
  });

  it('still fails on a UTF-8 text assignment spaced with non-breaking spaces', () => {
    // Read as UTF-8, U+00A0 is whitespace to the assignment pattern; read byte by byte it is
    // two characters, one of them not whitespace.
    writeFileSync(
      join(dist, 'config.txt'),
      `token\u00a0=\u00a0"Hx7Qm2Vz9Kp4Wr8Tn3By6Cf1Dj5Ls0Ae"\n`,
      'utf8'
    );
    const result = scan();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /config\.txt:1: high-entropy-assignment/);
  });

  it('names file, line and rule but prints neither the token nor what sits next to it', () => {
    // A credential no rule knows, beside one gitleaks recognises: gitleaks' verbose output
    // redacts the token and prints the rest of the matched line.
    const neighbour = 'Vb7Rk2Qz9Xw4Lm8T';
    writeFileSync(join(dist, 'config.js'), `\nconst keys = ["${neighbour}", "${token}"];\n`);
    const result = scan();
    assert.notEqual(result.status, 0);
    const output = result.stdout + result.stderr;
    assert.match(output, /config\.js:2: github-token/);
    assert.match(output, /config\.js:2: github-pat \(gitleaks\)/);
    assert.ok(!output.includes(neighbour), 'printed the neighbouring credential');
    assert.ok(!output.includes(token), 'printed the token');
  });
});

describe('just scan-secrets-source (gitleaks over git history)', () => {
  it('reports a committed token by file, line, rule and commit, without its value', () => {
    const repo = join(dist, 'repo');
    mkdirSync(repo);
    const git = (...args: string[]) =>
      execFileSync(
        'git',
        ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args],
        {
          env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
        }
      );
    git('init', '-q');
    writeFileSync(join(repo, 'leak.js'), `export const key = "${token}";\n`);
    git('add', 'leak.js');
    git('commit', '-q', '-m', 'leak');
    const result = spawnSync(
      process.execPath,
      [join(root, 'scripts/gitleaks-report.ts'), 'git', repo],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${join(root, '.tools/bin')}:${process.env.PATH ?? ''}` },
      }
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /leak\.js:1: github-pat \(gitleaks\) \(commit [0-9a-f]{12}\)/);
    assert.ok(!(result.stdout + result.stderr).includes(token), 'printed the token');
  });
});
