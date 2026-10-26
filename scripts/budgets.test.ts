// The static budgets against small built sites written to a temporary directory.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { measure } from './budgets.ts';

const limits = { jsWithoutIslands: 0, jsWithIslands: 20_480, pageWeight: 153_600, fonts: 204_800 };

/** Bytes gzip cannot shrink, the same on every run. */
function incompressible(length: number): Buffer {
  const chunks: Buffer[] = [];
  for (let i = 0; chunks.length * 32 < length; i++) {
    chunks.push(createHash('sha256').update(String(i)).digest());
  }
  return Buffer.concat(chunks).subarray(0, length);
}
/** JavaScript that stays about `length` bytes after gzip. */
const js = (length: number) => `export const blob = "${incompressible(length).toString('hex')}";`;

const page = (body: string, head = '') =>
  `<!DOCTYPE html><html lang="en"><head><title>t</title>${head}</head><body>${body}</body></html>`;
const island = (component: string) =>
  `<astro-island uid="1" component-url="${component}" renderer-url="/_astro/r.js" client="idle" props="{&quot;a&quot;:&quot;&gt;&quot;}"></astro-island>`;

let dist: string;
const write = (files: Record<string, string | Buffer>) => {
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dist, file)), { recursive: true });
    writeFileSync(join(dist, file), content);
  }
};
const problems = () => measure(dist, limits).problems;

beforeEach(() => {
  dist = mkdtempSync(join(tmpdir(), 'min7-budgets-'));
});
afterEach(() => rmSync(dist, { recursive: true, force: true }));

describe('JavaScript per page', () => {
  it('allows no JavaScript at all on a page without islands', () => {
    write({
      'index.html': page('<p>hi</p>'),
      'about.html': page('<p>hi</p><script type="module" src="/_astro/tiny.js"></script>'),
      '_astro/tiny.js': 'console.log(1)',
    });
    const report = measure(dist, limits);
    assert.equal(report.pages.find((p) => p.page === 'index.html')?.js, 0);
    assert.equal(report.problems.length, 1);
    assert.match(report.problems[0] ?? '', /^about\.html: \d+ B of JavaScript .* without islands/);
  });

  it('counts the shared chunks an island imports, not just its own file', () => {
    write({
      'index.html': page(island('/_astro/Search.js')),
      '_astro/Search.js': 'import{a as e}from"./client.js";export default e;',
      '_astro/r.js': 'import"./client.js";export default 1;',
      '_astro/client.js': js(12_000),
    });
    assert.deepEqual(problems(), []);
    // The same island with a chunk that pushes the page past 20 KB fails.
    write({ '_astro/client.js': `import"./extra.js";${js(12_000)}`, '_astro/extra.js': js(9000) });
    assert.match(problems()[0] ?? '', /^index\.html: \d+ B of JavaScript .* with islands/);
  });

  it('does not count a module the page only loads on demand', () => {
    write({
      'index.html': page(island('/_astro/Search.js')),
      '_astro/Search.js': 'export const s=()=>import("/pagefind/pagefind.js");',
      '_astro/r.js': 'export default 1;',
      'pagefind/pagefind.js': js(30_000),
    });
    assert.deepEqual(problems(), []);
  });
});

describe('page weight and fonts', () => {
  it('fails a page over the weight budget and names it', () => {
    write({
      'index.html': page('<img src="/a.png" width="1" height="1" alt="">'),
      'post.html': page('<img src="/hero.jpg" width="1" height="1" alt="">'),
      'a.png': incompressible(1000),
      'hero.jpg': incompressible(160_000),
    });
    assert.deepEqual(problems(), [
      `post.html: weighs ${measure(dist, limits).pages[1]?.weight} B (gzip, no fonts), budget 153600 B`,
    ]);
  });

  it('leaves fonts out of page weight and checks them in total, woff2 only', () => {
    const css = '@font-face{font-family:a;src:url(/fonts/a.woff2)}@import "/b.css";';
    write({
      'index.html': page('<p>hi</p>', '<link rel="stylesheet" href="/a.css">'),
      'a.css': css,
      'b.css': '@font-face{font-family:b;src:url(./fonts/b.woff2)}',
      'fonts/a.woff2': incompressible(140_000),
      'fonts/b.woff2': incompressible(40_000),
    });
    assert.deepEqual(problems(), []);
    write({ 'fonts/c.ttf': incompressible(30_000) });
    assert.deepEqual(problems(), [
      'fonts/c.ttf: fonts ship as woff2 only',
      'fonts: 210000 B in total, budget 204800 B',
    ]);
  });
});

describe('external origins', () => {
  it('fails any request to another origin from HTML or CSS, and allows plain links', () => {
    write({
      'index.html': page(
        [
          '<a href="https://github.com/x">GitHub</a>',
          '<script src="//cdn.example.com/x.js"></script>',
          '<img src="https://img.example.com/a.png" width="1" height="1" alt="">',
          '<div style="background:url(&quot;https://bg.example.com/a.png&quot;)"></div>',
          '<script>const u = "<img src=https://not-markup.example.com/a.png>";</script>',
        ].join(''),
        [
          '<link rel="canonical" href="https://ayagmar.dev/">',
          '<link rel="me" href="https://social.example.com/@a">',
          '<link rel="preconnect" href="https://fonts.gstatic.com">',
          '<link rel="stylesheet" href="/a.css">',
          '<!-- <link rel="stylesheet" href="https://commented.example.com/x.css"> -->',
        ].join('')
      ),
      'a.css':
        '@import url("https://fonts.googleapis.com/css2?family=X");/* url(https://c.example.com) */',
    });
    const found = problems().flatMap((p) => /loads (\S+) from another origin/.exec(p)?.[1] ?? []);
    assert.deepEqual(found.sort(), [
      '//cdn.example.com/x.js',
      'https://bg.example.com/a.png',
      'https://fonts.googleapis.com/css2?family=X',
      'https://fonts.gstatic.com',
      'https://img.example.com/a.png',
    ]);
  });

  it('reads comments as a browser does: closed at the first -->, an unclosed one to the end', () => {
    write({
      'index.html': page(
        [
          // The comment ends at the first -->, so the image after it is markup.
          '<!-- a <!-- b --><img src="https://after-nested.example.com/a.png" width="1" height="1" alt=""> -->',
          '<!-- <img src="https://in-comment.example.com/a.png"> -->',
          // Unclosed: nothing after it is markup.
          '<!-- <img src="https://unclosed.example.com/a.png">',
        ].join('')
      ),
    });
    const found = problems().flatMap((p) => /loads (\S+) from another origin/.exec(p)?.[1] ?? []);
    assert.deepEqual(found, ['https://after-nested.example.com/a.png']);
  });
});

describe('images and references', () => {
  it('fails an <img> without both width and height', () => {
    write({
      'index.html': page(
        '<img src="/a.png" width="10" height="10" alt=""><img src="/b.png" width="10" alt=""><img alt="" src=/c.png>'
      ),
      'a.png': 'a',
      'b.png': 'b',
      'c.png': 'c',
    });
    assert.deepEqual(problems(), [
      'index.html: <img src="/b.png"> has no width and height (layout shift)',
      'index.html: <img src="/c.png"> has no width and height (layout shift)',
    ]);
  });

  it('fails a reference to a file the build does not contain, relative ones included', () => {
    write({
      'writing/post.html': page('<img src="cover.png" width="1" height="1" alt="">'),
    });
    assert.deepEqual(problems(), [
      'writing/post.html: references cover.png, which is not in the build',
    ]);
  });
});

it('prints the per-page table and exits 1 over budget', () => {
  write({ 'index.html': page('<script src="/x.js"></script>'), 'x.js': 'console.log(1)' });
  const result = spawnSync(process.execPath, [join(import.meta.dirname, 'budgets.ts'), dist], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /index\.html\s+0\.\d KB\s+0\.0 KB .* OVER/);
  assert.match(result.stderr, /budgets: index\.html: \d+ B of JavaScript/);
});
