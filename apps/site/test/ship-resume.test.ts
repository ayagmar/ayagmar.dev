import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { shipResume } from '../scripts/ship-resume.ts';

let root: string;
let dist: string;
let generated: string;
let override: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'min7-resume-'));
  dist = join(root, 'dist');
  mkdirSync(dist);
  generated = join(root, 'generated.pdf');
  override = join(root, 'override.pdf');
  writeFileSync(generated, 'generated');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const shipped = () => readFileSync(join(dist, 'resume.pdf'), 'utf8');

describe('shipping the resume', () => {
  it('ships nothing while unpublished, even with a PDF ready', () => {
    writeFileSync(override, 'override');
    shipResume({ published: false, dist, generated, override });
    expect(existsSync(join(dist, 'resume.pdf'))).toBe(false);
  });

  it('ships the generated PDF once published', () => {
    shipResume({ published: true, dist, generated, override });
    expect(shipped()).toBe('generated');
  });

  it('ships a hand-made override instead of the generated PDF', () => {
    writeFileSync(override, 'override');
    shipResume({ published: true, dist, generated, override });
    expect(shipped()).toBe('override');
  });

  it('fails the build when published but nothing was generated', () => {
    rmSync(generated);
    expect(() => shipResume({ published: true, dist, generated, override })).toThrow(
      /run `just resume`/
    );
  });
});
