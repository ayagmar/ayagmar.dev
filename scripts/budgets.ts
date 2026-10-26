// Static performance budgets on the built site (ADR 0017), checked without a browser: the
// JavaScript each page loads, each page's weight without fonts, the fonts in total, no request
// to another origin from HTML or CSS, and width and height on every <img>. The numbers live in
// scripts/budgets.json, which the Lighthouse script reads too.
// Usage: node scripts/budgets.ts [dist]   (default apps/site/dist); exits 1 over budget.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

export interface Budgets {
  static: {
    /** Bytes of JavaScript (gzip) a page without islands may load. */
    jsWithoutIslands: number;
    /** Bytes of JavaScript (gzip) a page with islands may load. */
    jsWithIslands: number;
    /** Bytes (gzip where text) of a page's HTML, CSS, JS and images, fonts excluded. */
    pageWeight: number;
    /** Bytes of every font file in the build together. */
    fonts: number;
  };
  lighthouse: {
    runs: number;
    /** Page name to path; a path ending in `/*` means the largest page directly under it. */
    pages: Record<string, string>;
    assert: Record<'mobile' | 'desktop', Record<string, number>>;
    /** Per profile, a head value fails when it is over base × ratio and over base + delta. */
    regression: Record<'mobile' | 'desktop', Record<string, { ratio: number; delta: number }>>;
  };
}

export const budgets = JSON.parse(
  readFileSync(join(import.meta.dirname, 'budgets.json'), 'utf8')
) as Budgets;

export interface PageReport {
  /** The page's path in dist, such as `writing/a-post.html`. */
  page: string;
  islands: boolean;
  /** JavaScript the page loads, gzip bytes. */
  js: number;
  /** HTML, CSS, JS and images, gzip where text, fonts excluded. */
  weight: number;
}

export interface Report {
  pages: PageReport[];
  /** Every font file in dist, bytes. */
  fonts: number;
  problems: string[];
}

const textTypes = new Set(['.html', '.css', '.js', '.mjs', '.svg', '.json', '.txt', '.xml']);
const fontTypes = new Set(['.woff2', '.woff', '.ttf', '.otf', '.eot']);
const jsTypes = new Set(['', 'module', 'text/javascript', 'application/javascript']);
// <link> relations that make the browser fetch something.
const fetchingRels = new Set([
  'stylesheet',
  'preload',
  'modulepreload',
  'prefetch',
  'preconnect',
  'dns-prefetch',
  'icon',
  'apple-touch-icon',
  'mask-icon',
  'manifest',
]);

// A comment (to its end, or to the end of the document as a browser reads an unclosed one), or
// a start tag with its attributes. Comments match without groups and are skipped.
const tag =
  /<!--[\s\S]*?(?:-->|$)|<([a-zA-Z][\w:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g;
const attribute = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const inlineCode = /<(script|style)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
const staticImport = /\b(?:import|export)\s*(?:[\w$*{}\s,]+?\s*from\s*)?["']([^"']+)["']/g;
// CSS function and at-rule names are case-insensitive. `@import` takes a string or url();
// url() a quoted or bare URL; image-set() also takes bare strings as URLs.
const cssImport = /@import\s*(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^"')\s;]+))/gi;
const cssUrl = /\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^"')\s]*))\s*\)/gi;
const cssImageSet = /(?:-webkit-)?image-set\(/gi;

/** The URLs a stylesheet makes the browser load; `imported` marks another stylesheet. */
function cssUrls(css: string): { url: string; imported: boolean }[] {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const first = (groups: (string | undefined)[]) => groups.find((g) => g !== undefined) ?? '';
  const out = [...code.matchAll(cssImport)].map((m) => ({
    url: first(m.slice(1)),
    imported: true,
  }));
  for (const m of code.matchAll(cssUrl)) {
    // An @import url() is already listed as an import.
    if (!/@import\s*$/i.test(code.slice(0, m.index)))
      out.push({ url: first(m.slice(1)), imported: false });
  }
  // image-set()'s own strings, at its top level: a string inside type() is a MIME type.
  for (const m of code.matchAll(cssImageSet)) {
    let depth = 1;
    for (let i = m.index + m[0].length; i < code.length && depth > 0; i++) {
      const char = code[i];
      if (char === '(') depth++;
      else if (char === ')') depth--;
      else if (char === '"' || char === "'") {
        const end = code.indexOf(char, i + 1);
        if (end === -1) break;
        if (depth === 1) out.push({ url: code.slice(i + 1, end), imported: false });
        i = end;
      }
    }
  }
  return out;
}

/** A character reference as a browser reads it; one out of range becomes U+FFFD. */
const codePoint = (n: number) => String.fromCodePoint(n > 0 && n <= 0x10ffff ? n : 0xfffd);

// Numeric references first and `&amp;` last, so `&amp;#9;` stays the text `&#9;`.
const decode = (value: string) =>
  value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => codePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec: string) => codePoint(Number.parseInt(dec, 10)))
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');

function attributes(source: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [, name = '', ...values] of source.matchAll(attribute)) {
    out.set(name.toLowerCase(), decode(values.find((v) => v !== undefined) ?? ''));
  }
  return out;
}

// Stands for the site's own origin when resolving references; `.invalid` never resolves.
const site = 'https://site.invalid';

const gz = (bytes: Buffer | string) => gzipSync(bytes, { level: 9 }).length;

/** Every file under a directory, as paths relative to it with `/` separators. */
function files(root: string): string[] {
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((file) => statSync(join(root, file)).isFile())
    .map((file) => file.split(sep).join('/'))
    .sort();
}

/** The URL path a page in dist is served at: `writing/a.html` is `/writing/a`. */
function pageUrl(page: string): string {
  const path = `/${page.replace(/\.html$/, '')}`;
  return path.endsWith('/index') ? path.slice(0, -'index'.length) : path;
}

export function measure(dist: string, limits: Budgets['static'] = budgets.static): Report {
  const problems: string[] = [];
  const all = files(dist);
  const sizes = new Map<string, number>();
  /** Transfer size of a file in dist: gzip for text, bytes for the rest. */
  const size = (file: string) => {
    let bytes = sizes.get(file);
    if (bytes === undefined) {
      const content = readFileSync(join(dist, file));
      bytes = textTypes.has(extname(file)) ? gz(content) : content.length;
      sizes.set(file, bytes);
    }
    return bytes;
  };
  /** The dist file a same-site reference points to, or undefined (reported) when there is none. */
  const resolve = (url: string, from: string, where: string): string | undefined => {
    // Parsed as a browser does first (whitespace and control characters trimmed, tabs and
    // newlines removed, backslashes as slashes), so the origin checked is the one requested.
    let parsed: URL;
    try {
      parsed = new URL(url, `${site}${from}`);
    } catch {
      problems.push(`${where}: references ${JSON.stringify(url)}, which is not a valid URL`);
      return undefined;
    }
    if (parsed.protocol === 'data:') return undefined;
    if (parsed.origin !== site) {
      problems.push(`${where}: loads ${parsed.href} from another origin; self-host it`);
      return undefined;
    }
    const { pathname } = parsed;
    const path = decodeURIComponent(pathname).slice(1);
    const candidates = path === '' || path.endsWith('/') ? [`${path}index.html`] : [path];
    if (!extname(path)) candidates.push(`${path}.html`, `${path}/index.html`);
    const found = candidates.find((file) => existsSync(join(dist, file)));
    if (!found) problems.push(`${where}: references ${url}, which is not in the build`);
    return found;
  };

  /** A stylesheet and what it pulls in (other stylesheets, images, fonts). */
  const cssClosure = (file: string, into: Set<string>) => {
    if (into.has(file)) return;
    into.add(file);
    references(readFileSync(join(dist, file), 'utf8'), `/${file}`, file, into);
  };
  const references = (css: string, from: string, where: string, into: Set<string>) => {
    for (const { url, imported } of cssUrls(css)) {
      const target = resolve(url, from, where);
      if (!target) continue;
      if (imported) cssClosure(target, into);
      else into.add(target);
    }
  };

  /** A module and its static imports; dynamic import() runs on demand, not on load. */
  const jsClosure = (file: string, into: Set<string>) => {
    if (into.has(file)) return;
    into.add(file);
    if (!/\.m?js$/.test(file)) return;
    for (const [, specifier = ''] of readFileSync(join(dist, file), 'utf8').matchAll(
      staticImport
    )) {
      const target = resolve(specifier, `/${file}`, file);
      if (target) jsClosure(target, into);
    }
  };

  const pages: PageReport[] = [];
  for (const page of all.filter((file) => file.endsWith('.html'))) {
    const html = readFileSync(join(dist, page), 'utf8');
    const url = pageUrl(page);
    const scripts = new Set<string>();
    const resources = new Set<string>();
    let inlineJs = 0;

    for (const [, kind = '', attrs = '', body = ''] of html.matchAll(inlineCode)) {
      const a = attributes(attrs);
      if (kind.toLowerCase() === 'style') references(body, url, page, resources);
      else if (!a.has('src') && jsTypes.has((a.get('type') ?? '').toLowerCase())) {
        inlineJs += gz(body);
      }
    }
    // Inline code is not markup.
    const markup = html.replace(inlineCode, '<$1$2></$1>');
    let islands = false;
    for (const [, name, attrs = ''] of markup.matchAll(tag)) {
      if (name === undefined) continue;
      const element = name.toLowerCase();
      const a = attributes(attrs);
      const load = (value: string | undefined, into: Set<string>) => {
        const target = value ? resolve(value, url, page) : undefined;
        if (target && into === scripts) jsClosure(target, scripts);
        else if (target && extname(target) === '.css') cssClosure(target, resources);
        else if (target) into.add(target);
      };
      if (element === 'astro-island') {
        islands = true;
        for (const key of ['component-url', 'renderer-url', 'before-hydration-url']) {
          load(a.get(key), scripts);
        }
      } else if (element === 'script') {
        if (jsTypes.has((a.get('type') ?? '').toLowerCase())) load(a.get('src'), scripts);
      } else if (element === 'link') {
        const rels = (a.get('rel') ?? '').toLowerCase().split(/\s+/);
        if (rels.some((rel) => fetchingRels.has(rel))) {
          load(a.get('href'), rels.includes('modulepreload') ? scripts : resources);
        }
      } else if (['use', 'image', 'feimage'].includes(element)) {
        const href = a.get('href') ?? a.get('xlink:href');
        if (href && !href.startsWith('#')) load(href, resources);
      } else {
        load(a.get('src'), resources);
        load(a.get('poster'), resources);
        if (element === 'object') load(a.get('data'), resources);
      }
      for (const candidate of (a.get('srcset') ?? '').split(',')) {
        load(candidate.trim().split(/\s+/)[0], resources);
      }
      const style = a.get('style');
      if (style) references(style, url, page, resources);
      // `auto`, 0 or a negative value reserves no space; units and fractions are not the
      // build's own output, so they fail too.
      const dimension = (name: string) => /^[1-9][0-9]*$/.test(a.get(name) ?? '');
      if (element === 'img' && !(dimension('width') && dimension('height'))) {
        problems.push(
          `${page}: <img src="${a.get('src') ?? ''}"> has no width and height as positive whole numbers (layout shift)`
        );
      }
    }

    const js = inlineJs + [...scripts].reduce((sum, file) => sum + size(file), 0);
    const weight =
      size(page) +
      [...scripts, ...resources]
        .filter((file) => !fontTypes.has(extname(file)))
        .reduce((sum, file) => sum + size(file), 0);
    pages.push({ page, islands, js, weight });

    const jsLimit = islands ? limits.jsWithIslands : limits.jsWithoutIslands;
    if (js > jsLimit) {
      problems.push(
        `${page}: ${js} B of JavaScript (gzip), budget ${jsLimit} B for a page ${islands ? 'with' : 'without'} islands`
      );
    }
    if (weight > limits.pageWeight) {
      problems.push(`${page}: weighs ${weight} B (gzip, no fonts), budget ${limits.pageWeight} B`);
    }
  }

  const fontFiles = all.filter((file) => fontTypes.has(extname(file)));
  for (const file of fontFiles.filter((f) => extname(f) !== '.woff2')) {
    problems.push(`${file}: fonts ship as woff2 only`);
  }
  const fonts = fontFiles.reduce((sum, file) => sum + size(file), 0);
  if (fonts > limits.fonts) problems.push(`fonts: ${fonts} B in total, budget ${limits.fonts} B`);

  for (const css of all.filter((file) => file.endsWith('.css'))) {
    references(readFileSync(join(dist, css), 'utf8'), `/${css}`, css, new Set());
  }
  return { pages, fonts, problems: [...new Set(problems)] };
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

export function table(report: Report, limits: Budgets['static'] = budgets.static): string {
  const rows = report.pages.map((p) => {
    const jsLimit = p.islands ? limits.jsWithIslands : limits.jsWithoutIslands;
    const ok = p.js <= jsLimit && p.weight <= limits.pageWeight;
    return [p.page, kb(p.js), kb(jsLimit), kb(p.weight), kb(limits.pageWeight), ok ? 'ok' : 'OVER'];
  });
  const header = ['page', 'js (gz)', 'js budget', 'weight (gz)', 'weight budget', ''];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[]) =>
    cells
      .map((c, i) => (i === 0 ? c.padEnd(widths[i] ?? 0) : c.padStart(widths[i] ?? 0)))
      .join('  ')
      .trimEnd();
  return [
    line(header),
    ...rows.map(line),
    '',
    `fonts: ${kb(report.fonts)} of ${kb(limits.fonts)}`,
  ].join('\n');
}

if (import.meta.main) {
  const dist = process.argv[2] ?? join(import.meta.dirname, '..', 'apps/site/dist');
  const report = measure(dist);
  console.log(`budgets: ${relative(process.cwd(), dist) || '.'}\n`);
  console.log(table(report));
  for (const problem of report.problems) console.error(`budgets: ${problem}`);
  if (report.pages.length === 0) {
    console.error('budgets: no HTML pages found; run just site-build first');
    process.exit(1);
  }
  process.exit(report.problems.length > 0 ? 1 : 0);
}
