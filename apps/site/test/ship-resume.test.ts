import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { aboutFile } from '../scripts/ship-resume.ts';

const script = join(import.meta.dirname, '..', 'scripts', 'ship-resume.ts');
const committed = JSON.parse(readFileSync(aboutFile, 'utf8'));

// A repo root with its own about.json, generated PDF and optional override, as the build sees it.
let root: string;
let dist: string;

function setUp({ published, override }: { published: boolean; override?: string }) {
  mkdirSync(join(root, 'content'));
  mkdirSync(join(root, 'resume', 'build'), { recursive: true });
  writeFileSync(
    join(root, 'content', 'about.json'),
    JSON.stringify({ ...committed, resume: { published } })
  );
  writeFileSync(join(root, 'resume', 'build', 'resume.pdf'), 'generated');
  if (override !== undefined) writeFileSync(join(root, 'resume', 'override.pdf'), override);
}

const ship = () => spawnSync(process.execPath, [script, dist, root], { encoding: 'utf8' });
const shipped = () => readFileSync(join(dist, 'resume.pdf'), 'utf8');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'min7-resume-'));
  dist = join(root, 'dist');
  mkdirSync(dist);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('ship-resume after the site build', () => {
  it('ships nothing while unpublished, even with an override ready', () => {
    setUp({ published: false, override: 'override' });
    expect(ship().status).toBe(0);
    expect(existsSync(join(dist, 'resume.pdf'))).toBe(false);
  });

  it('ships the generated PDF once published', () => {
    setUp({ published: true });
    expect(ship().status).toBe(0);
    expect(shipped()).toBe('generated');
  });

  it('ships a hand-made override instead of the generated PDF', () => {
    setUp({ published: true, override: 'override' });
    expect(ship().status).toBe(0);
    expect(shipped()).toBe('override');
  });

  it('fails the build when published but nothing was generated', () => {
    setUp({ published: true });
    rmSync(join(root, 'resume', 'build', 'resume.pdf'));
    const result = ship();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/run `just resume`/);
  });
});
