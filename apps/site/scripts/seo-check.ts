// Runs after postbuild on a built site and fails it when what search engines read is wrong
// (docs/seo.md): every page has exactly one canonical link, one non-empty title and one
// non-empty description, none shared with another page (only a warning between project
// pages, whose descriptions come from GitHub); every JSON-LD block parses and each
// node has a @type; every post and TIL note page has a BlogPosting. The sitemap lists only
// built, indexable pages under their canonical URL, dates articles as their JSON-LD does, and
// never lists a draft.
// Usage: node scripts/seo-check.ts [dist] [content]   (defaults apps/site/dist, content/)
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  lastModified,
  noindexMeta,
  pageFile,
  sitemapEntries,
  structuredNodes,
} from '../src/lib/sitemap.ts';

const dist = process.argv[2] ?? join(import.meta.dirname, '..', 'dist');
const content = process.argv[3] ?? join(import.meta.dirname, '..', '..', '..', 'content');

const problems: string[] = [];
const all = (html: string, pattern: RegExp) => [...html.matchAll(pattern)].map((m) => m[1] ?? '');

const pages = readdirSync(dist, { recursive: true, encoding: 'utf8' })
  .map((file) => file.split('\\').join('/'))
  .filter((file) => file.endsWith('.html') && !file.startsWith('pagefind/'))
  .sort();
const seen = { title: new Map<string, string>(), description: new Map<string, string>() };
const html = new Map<string, string>();

for (const page of pages) {
  const text = readFileSync(join(dist, page), 'utf8');
  html.set(page, text);
  const canonical = all(text, /<link rel="canonical" href="([^"]*)"/g);
  if (canonical.length !== 1) problems.push(`${page}: ${canonical.length} canonical links, not 1`);
  const fields = {
    title: all(text, /<title>([^<]*)<\/title>/g),
    description: all(text, /<meta name="description" content="([^"]*)"/g),
  };
  for (const [field, values] of Object.entries(fields) as [keyof typeof fields, string[]][]) {
    const [value = ''] = values;
    if (values.length !== 1 || value.trim() === '') {
      problems.push(`${page}: needs exactly one non-empty ${field}, has ${JSON.stringify(values)}`);
      continue;
    }
    const other = seen[field].get(value);
    if (other === undefined) seen[field].set(value, page);
    else if (field === 'description' && [page, other].some((p) => p.startsWith('projects/'))) {
      // A project's description comes from GitHub at build time (src/lib/projects.ts): two repos
      // with the same one must not stop production deploying.
      console.warn(`seo-check: warning: ${page}: same ${field} as ${other}: ${value}`);
    } else problems.push(`${page}: same ${field} as ${other}: ${value}`);
  }
  let nodes: Record<string, unknown>[] = [];
  try {
    nodes = structuredNodes(text);
  } catch (error) {
    problems.push(`${page}: JSON-LD does not parse: ${(error as Error).message}`);
  }
  for (const node of nodes) {
    if (typeof node['@type'] !== 'string') problems.push(`${page}: a JSON-LD node has no @type`);
  }
  const article = /^(writing|til)\/[^/]+\.html$/.test(page) && !page.startsWith('writing/tags/');
  if (article && !nodes.some((node) => node['@type'] === 'BlogPosting')) {
    problems.push(`${page}: a post or note without a BlogPosting`);
  }
}

/** Slugs whose frontmatter says `draft: true`, as the URLs they would have. */
function drafts(collection: 'writing' | 'til'): string[] {
  return readdirSync(join(content, collection))
    .filter((file) => file.endsWith('.md'))
    .filter((file) => {
      const front = /^---\n([\s\S]*?)\n---/.exec(
        readFileSync(join(content, collection, file), 'utf8')
      );
      return /^draft:\s*true\s*$/m.test(front?.[1] ?? '');
    })
    .map((file) => `/${collection}/${file.replace(/\.md$/, '')}`);
}

const maps = readdirSync(dist).filter((file) => /^sitemap-\d+\.xml$/.test(file));
if (maps.length === 0) problems.push('no sitemap-*.xml in the build');
const listed = new Set<string>();
for (const map of maps) {
  const xml = readFileSync(join(dist, map), 'utf8');
  for (const [loc, lastmod] of Object.entries(sitemapEntries(xml))) {
    listed.add(new URL(loc).pathname);
    const page = pageFile(loc);
    const text = html.get(page);
    if (text === undefined) {
      problems.push(`${map}: lists ${loc}, which is not a built page`);
      continue;
    }
    if (noindexMeta.test(text)) problems.push(`${map}: lists ${loc}, which is noindex`);
    const canonical = /<link rel="canonical" href="([^"]*)"/.exec(text)?.[1];
    if (canonical !== loc) problems.push(`${map}: lists ${loc}, whose canonical is ${canonical}`);
    const modified = lastModified(text);
    if ((lastmod ?? undefined) !== modified) {
      problems.push(`${map}: ${loc} has lastmod ${lastmod}, its JSON-LD dateModified ${modified}`);
    }
  }
}
for (const path of [...drafts('writing'), ...drafts('til')]) {
  if (listed.has(path)) problems.push(`sitemap lists the draft ${path}`);
}

if (pages.length === 0) problems.push('no HTML pages; run just site-build first');
for (const problem of problems) console.error(`seo-check: ${problem}`);
console.log(
  `seo-check: ${pages.length} pages, ${listed.size} in the sitemap, ${problems.length} problems`
);
process.exit(problems.length > 0 ? 1 : 0);
