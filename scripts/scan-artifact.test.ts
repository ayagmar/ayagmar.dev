// The artifact scan as CI runs it (`just scan-artifact`, both scanners), on planted fake
// secrets assembled at run time in a temporary directory.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
});
