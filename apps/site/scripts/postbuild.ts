// Runs after `astro build` and `pagefind`: writes dist/_headers with one site-wide
// Content-Security-Policy. Inline scripts and styles are allowed by hash only when they are
// exactly what Astro itself emits (the island runtime, its hydration directives and the island
// style). Any other inline <script> or <style>, such as raw HTML in a Markdown post, fails the
// build instead of being hashed into the policy. A `type="application/ld+json"` block is data a
// browser never runs, so it needs no hash, but it must parse as JSON.
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

/**
 * The <script> and <style> elements of a page, found the way a browser tokenizes tags:
 * comments and quoted attribute values are skipped whole, so text like `content="<script>..."`
 * is not an element, and tag and attribute names are matched case-insensitively. `type` and
 * `src` are the first of each attribute, as a browser reads them; `body` is the inline content.
 */
function* elements(html: string): Generator<{
  kind: 'script' | 'style';
  body: string;
  type: string | undefined;
  src: string | undefined;
}> {
  const markup = /<!--[\s\S]*?(?:-->|$)|<([a-zA-Z][^\s/>]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  const attribute = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  const lower = html.toLowerCase();
  for (let match = markup.exec(html); match !== null; match = markup.exec(html)) {
    const [, name, attributes = ''] = match;
    const kind = name?.toLowerCase();
    if (kind !== 'script' && kind !== 'style') continue;
    // Script and style content is raw text up to the matching end tag.
    const end = lower.indexOf(`</${kind}`, markup.lastIndex);
    const body = html.slice(markup.lastIndex, end === -1 ? html.length : end);
    markup.lastIndex = end === -1 ? html.length : end;
    const values = new Map<string, string>();
    for (const [, name = '', ...value] of attributes.matchAll(attribute)) {
      const key = name.toLowerCase();
      if (!values.has(key)) values.set(key, value.find((v) => v !== undefined) ?? '');
    }
    yield { kind, body, type: values.get('type')?.trim().toLowerCase(), src: values.get('src') };
  }
}

const hashes = { script: new Set<string>(), style: new Set<string>() };
const rejected: string[] = [];
for (const file of pages) {
  for (const { kind, body, type, src } of elements(readFileSync(join(dist, file), 'utf8'))) {
    if (kind === 'script' && src !== undefined) continue;
    if (kind === 'script' && type === 'application/ld+json') {
      try {
        JSON.parse(body);
      } catch (error) {
        rejected.push(`${file}: JSON-LD that does not parse: ${(error as Error).message}`);
      }
      continue;
    }
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
