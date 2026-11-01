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
    /**
     * Modules a page imports dynamically only after a user action, so they are not counted.
     * Every other dynamic import counts: it can run as soon as the page loads.
     */
    onDemand: string[];
    /**
     * Named scripts left out of the per-page JS budget, each capped on its own (gzip bytes).
     * `file` is a URL path where `*` stands for any characters but `/`, such as a build hash.
     */
    allowances: { name: string; file: string; bytes: number }[];
    /**
     * Scripts from another origin a page may load with `<script src>`, by exact URL, and only
     * that way: Cloudflare's Web Analytics beacon (ADR 0019). Not in the build, so not counted.
     */
    externalScripts: string[];
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
  /** JavaScript the page loads, gzip bytes, allowances left out. */
  js: number;
  /** JavaScript covered by an allowance, gzip bytes. */
  allowed: number;
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
// What JavaScript allows between the tokens of an import: whitespace and comments, which
// bundlers emit there (`/* @vite-ignore */`). Matched in place rather than stripped first, since
// a `//` inside a string is not a comment. A comment ends at its first `*/`, so no text can be
// read as a gap in two ways and a failed match does not backtrack through every split.
const gapUnit = String.raw`\s|\/\*(?:[^*]|\*(?!\/))*\*\/|\/\/[^\n]*\n`;
const gap = `(?:${gapUnit})*`;
const staticImport = new RegExp(
  String.raw`\b(?:import|export)(?:(?:[\w$*{},]|${gapUnit})+?from)?${gap}["']([^"']+)["']`,
  'g'
);
// import() of a literal URL; a computed one (Astro's island loader) cannot be followed.
const dynamicImport = new RegExp(
  String.raw`\bimport${gap}\(${gap}(["'\x60])([^"'\x60$]+)\1${gap}\)`,
  'g'
);
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

/** A tag's attributes by lowercased name; a repeated name keeps its first value, as browsers do. */
function attributes(source: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [, name = '', ...values] of source.matchAll(attribute)) {
    const key = name.toLowerCase();
    if (!out.has(key)) out.set(key, decode(values.find((v) => v !== undefined) ?? ''));
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
  const allowanceFor = (file: string) =>
    limits.allowances.find(({ file: glob }) =>
      new RegExp(
        `^${glob
          .split('*')
          .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
          .join('[^/]*')}$`
      ).test(`/${file}`)
    );
  /** The distinct files each allowance matched, across pages: it covers one. */
  const allowedFiles = new Map(limits.allowances.map((a) => [a, new Set<string>()]));
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

  /** Whether a script's src is, after a browser's normalization, one budgets.json allows. */
  const externalScript = (src: string | undefined, from: string) => {
    if (src === undefined) return false;
    try {
      return limits.externalScripts.includes(new URL(src, `${site}${from}`).href);
    } catch {
      return false;
    }
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

  /**
   * What a module's code imports, statically or with a literal import(), except the modules
   * budgets.json lists as loaded on demand. `from` is the URL relative imports resolve against.
   */
  const imports = (code: string, from: string, where: string, into: Set<string>) => {
    for (const [, specifier = ''] of code.matchAll(staticImport)) {
      const target = resolve(specifier, from, where);
      if (target) jsClosure(target, into);
    }
    for (const [, , specifier = ''] of code.matchAll(dynamicImport)) {
      const target = resolve(specifier, from, where);
      if (target && !limits.onDemand.includes(`/${target}`)) jsClosure(target, into);
    }
  };
  const jsClosure = (file: string, into: Set<string>) => {
    if (into.has(file)) return;
    into.add(file);
    if (/\.m?js$/.test(file))
      imports(readFileSync(join(dist, file), 'utf8'), `/${file}`, file, into);
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
        imports(body, url, page, scripts);
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
        const src = a.get('src');
        if (jsTypes.has((a.get('type') ?? '').toLowerCase()) && !externalScript(src, url)) {
          load(src, scripts);
        }
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

    let js = inlineJs;
    let allowed = 0;
    for (const file of scripts) {
      const allowance = allowanceFor(file);
      if (!allowance) {
        js += size(file);
        continue;
      }
      allowed += size(file);
      allowedFiles.get(allowance)?.add(file);
      if (size(file) > allowance.bytes) {
        problems.push(
          `${file}: ${size(file)} B (gzip), over the ${allowance.bytes} B allowance for the ${allowance.name}`
        );
      }
    }
    const weight =
      size(page) +
      [...scripts, ...resources]
        .filter((file) => !fontTypes.has(extname(file)))
        .reduce((sum, file) => sum + size(file), 0);
    pages.push({ page, islands, js, allowed, weight });

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

  for (const [allowance, matched] of allowedFiles) {
    if (matched.size > 1) {
      problems.push(
        `the ${allowance.name} allowance (${allowance.file}) matches ${matched.size} files, and covers one: ${[...matched].sort().join(', ')}`
      );
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
    const allowed = p.allowed > 0 ? kb(p.allowed) : '-';
    return [
      p.page,
      kb(p.js),
      kb(jsLimit),
      allowed,
      kb(p.weight),
      kb(limits.pageWeight),
      ok ? 'ok' : 'OVER',
    ];
  });
  const header = ['page', 'js (gz)', 'js budget', 'allowed js', 'weight (gz)', 'weight budget', ''];
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
    ...limits.allowances.map((a) => `allowed js: ${a.name} (${a.file}), at most ${kb(a.bytes)}`),
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
