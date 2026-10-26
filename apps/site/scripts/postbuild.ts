// Runs after `astro build` and `pagefind`: hashes every inline script and style Astro emitted
// and writes dist/_headers with one site-wide Content-Security-Policy.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  contentSecurityPolicy,
  renderHeadersFile,
  securityHeaders,
} from '../src/lib/security-headers.ts';

const dist = join(import.meta.dirname, '..', 'dist');

const html = readdirSync(dist, { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('.html'))
  .map((file) => readFileSync(join(dist, file), 'utf8'));

const hashesOf = (pattern: RegExp) => {
  const hashes = new Set<string>();
  for (const page of html) {
    for (const [, body = ''] of page.matchAll(pattern)) {
      hashes.add(`sha256-${createHash('sha256').update(body).digest('base64')}`);
    }
  }
  return [...hashes].sort();
};

const csp = contentSecurityPolicy({
  // Inline scripts only: <script> without src, any attributes otherwise.
  scripts: hashesOf(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g),
  styles: hashesOf(/<style[^>]*>([\s\S]*?)<\/style>/g),
});

writeFileSync(join(dist, '_headers'), renderHeadersFile(securityHeaders(csp)));
console.log(`postbuild: wrote _headers (CSP ${csp.length} characters)`);
