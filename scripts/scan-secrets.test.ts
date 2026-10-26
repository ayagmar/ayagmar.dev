// The planted secrets are built at run time in a temporary directory, so the repo, its history
// and the real artifacts never contain them and gitleaks needs no allowlist.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

const scanner = join(import.meta.dirname, 'scan-secrets.ts');
// Fake, random-looking bodies; joined with their prefixes only here.
const body = (length: number) =>
  Array.from({ length }, (_, i) => 'aZ3kQ9xW7mP2vR8nT5bY4cL6dF1gH0jS'[(i * 7 + length) % 32]).join(
    ''
  );
const planted = {
  'private-key': `-----BEGIN ${'OPENSSH'} PRIVATE KEY-----\n${body(64)}\n`,
  'github-token': `const t = "${['ghp', body(36)].join('_')}";`,
  'cloudflare-token': `fetch(u, { headers: { authorization: "Bearer ${['cfut', body(48)].join('_')}" } })`,
  'cloudflare-legacy-token': `var e={CLOUDFLARE_API_TOKEN:"${body(40)}"};`,
  'high-entropy-assignment': `const config={apiKey:"${body(32)}",mode:"api"};`,
};

let dir: string;
const run = (...dirs: string[]) =>
  spawnSync(process.execPath, [scanner, ...dirs], { encoding: 'utf8', cwd: dir });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'min7-scan-secrets-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('scan-secrets', () => {
  it('fails on each planted secret and names the file and rule, never the value', () => {
    mkdirSync(join(dir, 'dist/_astro'), { recursive: true });
    Object.entries(planted).forEach(([rule, text], i) => {
      writeFileSync(join(dir, 'dist/_astro', `chunk-${i}.js`), `// ${rule}\n${text}\n`);
    });
    const result = run('dist');
    assert.equal(result.status, 1);
    Object.keys(planted).forEach((rule, i) => {
      assert.match(result.stderr, new RegExp(`dist/_astro/chunk-${i}\\.js:2: ${rule}\\n`));
    });
    for (const text of Object.values(planted)) {
      for (const secret of text.match(/[A-Za-z0-9_]{32,}/g) ?? []) {
        assert.ok(!result.stderr.includes(secret), 'the scanner printed a secret');
      }
    }
  });

  it('passes ordinary built output: hashes, identifiers, low-entropy values', () => {
    mkdirSync(join(dir, 'dist'));
    writeFileSync(
      join(dir, 'dist/index.html'),
      [
        `<meta http-equiv="Content-Security-Policy" content="script-src 'sha256-${body(43)}='">`,
        `<script type="module" src="/_astro/page.${body(8)}.js" integrity="sha384-${body(64)}"></script>`,
        'const token = "dev"; const authorization = "Bearer " + token;',
        'const passwordField = "current-password-input-placeholder-text";',
        'const tokenizer = "abcdefghijklmnopqrstuvwxyz";',
      ].join('\n')
    );
    const result = run('dist');
    assert.equal(result.stderr, '');
    assert.equal(result.status, 0);
  });

  it('fails when a directory to scan is missing, so an unbuilt artifact is not a pass', () => {
    const result = run('dist');
    assert.notEqual(result.status, 0);
  });
});
