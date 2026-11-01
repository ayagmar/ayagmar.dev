/**
 * Makes the sitemap @astrojs/sitemap writes agree with the pages it lists: a page marked
 * `noindex` (tag pages, drafts on a Preview, the 404) is dropped, and a page with a `BlogPosting`
 * in its structured data gets that `dateModified` as `<lastmod>`. Runs after the sitemap
 * integration, on the built HTML, so each fact has one source: the page itself.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';

export const noindexMeta = /<meta name="robots" content="noindex">/;
const jsonLdScript = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;

/** The built file of a page URL (`build.format: 'file'`): `/` is index.html, `/a/b` a/b.html. */
export const pageFile = (loc: string) => {
  const path = new URL(loc).pathname;
  return path === '/' ? 'index.html' : `${decodeURIComponent(path.slice(1))}.html`;
};

/** Every schema.org node in a page's JSON-LD, `@graph` members one by one. */
export function structuredNodes(html: string): Record<string, unknown>[] {
  return [...html.matchAll(jsonLdScript)].flatMap(([, body = '']) => {
    const data = JSON.parse(body) as Record<string, unknown>;
    return Array.isArray(data['@graph']) ? (data['@graph'] as Record<string, unknown>[]) : [data];
  });
}

/** Page URL to its `<lastmod>`, null when it has none. */
export type Entries = Record<string, string | null>;

/** The `<url>` entries of one sitemap file. */
export function sitemapEntries(xml: string): Entries {
  const entries: Entries = {};
  for (const [, loc = '', lastmod] of xml.matchAll(
    /<url><loc>([^<]*)<\/loc>(?:<lastmod>([^<]*)<\/lastmod>)?/g
  )) {
    entries[loc] = lastmod ?? null;
  }
  return entries;
}

/** When the page's article last changed, from its BlogPosting, or undefined. */
export const lastModified = (html: string) =>
  structuredNodes(html).find((node) => node['@type'] === 'BlogPosting')?.dateModified as
    | string
    | undefined;

function rewrite(dist: string, xml: string): string {
  return xml.replace(/<url><loc>([^<]*)<\/loc><\/url>/g, (entry, loc: string) => {
    const file = join(dist, pageFile(loc));
    if (!existsSync(file)) return entry;
    const html = readFileSync(file, 'utf8');
    if (noindexMeta.test(html)) return '';
    const modified = lastModified(html);
    return modified === undefined
      ? entry
      : `<url><loc>${loc}</loc><lastmod>${modified}</lastmod></url>`;
  });
}

export function sitemapFromPages(): AstroIntegration {
  return {
    name: 'min7:sitemap-from-pages',
    hooks: {
      'astro:build:done': ({ dir, logger }) => {
        const dist = fileURLToPath(dir);
        const maps = readdirSync(dist).filter((f) => /^sitemap-\d+\.xml$/.test(f));
        if (maps.length === 0) throw new Error('no sitemap-*.xml: list sitemap() before this');
        for (const name of maps) {
          const path = join(dist, name);
          writeFileSync(path, rewrite(dist, readFileSync(path, 'utf8')));
        }
        logger.info(`dropped noindex pages and dated articles in ${maps.join(', ')}`);
      },
    },
  };
}
