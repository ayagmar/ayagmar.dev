import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import idle from 'astro/runtime/client/idle.prebuilt.js';
import island from 'astro/runtime/server/astro-island.prebuilt.js';
import { ISLAND_STYLES } from 'astro/runtime/server/astro-island-styles.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const postbuild = join(import.meta.dirname, '..', 'scripts', 'postbuild.ts');

// What Astro writes into every page with the search island.
const astroHead = `<style>${ISLAND_STYLES}</style><script>${idle}</script><script>${island}</script>`;
const page = (body: string) =>
  `<!DOCTYPE html><html><head>${astroHead}</head><body>${body}</body></html>`;

let dist: string;

function build(pages: Record<string, string>) {
  for (const [path, html] of Object.entries(pages)) {
    mkdirSync(dirname(join(dist, path)), { recursive: true });
    writeFileSync(join(dist, path), html);
  }
  return spawnSync(process.execPath, [postbuild, dist], { encoding: 'utf8' });
}

beforeEach(() => {
  dist = mkdtempSync(join(tmpdir(), 'min7-postbuild-'));
});
afterEach(() => {
  rmSync(dist, { recursive: true, force: true });
});

describe('postbuild CSP', () => {
  it("allows exactly Astro's own inline scripts and style", () => {
    const result = build({
      'index.html': page('<p>Hello</p>'),
      'about.html': page('<p>About</p>'),
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const csp = /Content-Security-Policy: (.*)/.exec(
      readFileSync(join(dist, '_headers'), 'utf8')
    )?.[1];
    expect(csp?.match(/'sha256-/g)).toHaveLength(3);
  });

  it('fails the build when a post carries its own inline script', () => {
    const post = page(
      '<article data-pagefind-body><p>Hi</p><script>fetch("/x")</script></article>'
    );
    const result = build({ 'index.html': page(''), 'writing/raw-html.html': post });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('writing/raw-html.html');
    expect(result.stderr).toContain('<script>');
    expect(() => readFileSync(join(dist, '_headers'))).toThrow();
  });

  it('fails the build when content adds an inline style element', () => {
    const result = build({ 'writing/styled.html': page('<style>body{display:none}</style>') });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('writing/styled.html');
    expect(result.stderr).toContain('<style>');
  });

  // A GitHub description becomes a project page's meta description; Astro escapes the quotes
  // but leaves angle brackets, which are text inside an attribute, not an element.
  it('ignores tag-like text inside quoted attribute values', () => {
    const description = 'Fixes <script>alert(2)</script> and <style>p{}</style> in docs';
    const result = build({
      'projects/ccdesk.html': page('').replace(
        '<head>',
        `<head><meta name="description" content="${description}"><meta content='<script>x</script>'>`
      ),
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('still rejects inline scripts that only pretend to load a src', () => {
    for (const script of [
      '<script data-note="src=/x.js">fetch("/x")</script>',
      '<SCRIPT>fetch("/x")</SCRIPT>',
      '<p title="a>b"></p><script>fetch("/x")</script>',
    ]) {
      const result = build({ 'writing/sneaky.html': page(script) });
      expect(result.status, script).toBe(1);
      expect(result.stderr, script).toContain('writing/sneaky.html');
    }
  });
});
