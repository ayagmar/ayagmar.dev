// Runs after `astro build` and `pagefind`: writes dist/_headers with one site-wide
// Content-Security-Policy. Inline scripts and styles are allowed by hash only when they are
// exactly what Astro itself emits (the island runtime, its hydration directives and the island
// style). Any other inline <script> or <style>, such as raw HTML in a Markdown post, fails the
// build instead of being hashed into the policy.
// Usage: node scripts/postbuild.ts [dist]
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import idle from 'astro/runtime/client/idle.prebuilt.js';
import load from 'astro/runtime/client/load.prebuilt.js';
import media from 'astro/runtime/client/media.prebuilt.js';
import only from 'astro/runtime/client/only.prebuilt.js';
import visible from 'astro/runtime/client/visible.prebuilt.js';
import island from 'astro/runtime/server/astro-island.prebuilt.js';
import { ISLAND_STYLES } from 'astro/runtime/server/astro-island-styles.js';
import {
  contentSecurityPolicy,
  renderHeadersFile,
  securityHeaders,
} from '../src/lib/security-headers.ts';

const allowed = {
  script: new Set<string>([island, idle, load, media, only, visible]),
  style: new Set<string>([ISLAND_STYLES]),
};

const dist = process.argv[2] ?? join(import.meta.dirname, '..', 'dist');
const pages = readdirSync(dist, { recursive: true, encoding: 'utf8' }).filter((file) =>
  file.endsWith('.html')
);

const hashes = { script: new Set<string>(), style: new Set<string>() };
const rejected: string[] = [];
// Inline elements only: <script> without src, any <style>.
const inline = /<(script|style)\b(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/\1>/g;
for (const file of pages) {
  for (const [, tag, body = ''] of readFileSync(join(dist, file), 'utf8').matchAll(inline)) {
    const kind = tag as 'script' | 'style';
    if (allowed[kind].has(body)) {
      hashes[kind].add(`sha256-${createHash('sha256').update(body).digest('base64')}`);
    } else {
      rejected.push(`${file}: inline <${kind}> not emitted by Astro: ${body.trim().slice(0, 80)}`);
    }
  }
}

if (rejected.length > 0) {
  for (const line of rejected) console.error(line);
  console.error(
    "\nThe CSP allows no inline scripts or styles except Astro's own. Move the code into a component <script> or stylesheet, or remove it from the post."
  );
  process.exit(1);
}

const csp = contentSecurityPolicy({
  scripts: [...hashes.script].sort(),
  styles: [...hashes.style].sort(),
});
writeFileSync(join(dist, '_headers'), renderHeadersFile(securityHeaders(csp)));
console.log(`postbuild: wrote _headers (CSP ${csp.length} characters)`);
