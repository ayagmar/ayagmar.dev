// Tells IndexNow search engines (Bing, Yandex, Seznam, Naver, Yep; one ping reaches them all)
// which pages of ayagmar.dev changed (docs/seo.md). The key is public; nothing here is secret.
//
//   node scripts/indexnow.ts snapshot <file>   save the live sitemap's URLs and lastmod
//   node scripts/indexnow.ts deployed <file>   after a deploy: ping what dist/ changed against
//                                              the snapshot; never fails the deploy
//   node scripts/indexnow.ts ping [url...]     ping these URLs, or every URL in the live sitemap
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { indexNowKey, sitemapUrl } from '../src/lib/search.ts';
import { siteUrl } from '../src/lib/site.ts';
import { type Entries, sitemapEntries } from '../src/lib/sitemap.ts';

const endpoint = 'https://api.indexnow.org/indexnow';
// Per request: the snapshot runs before the deploy, so a slow site must not hold it up.
const timeout = 5_000;
const dist = join(import.meta.dirname, '..', 'dist');

/**
 * What to ping after a deploy: pages that are new, whose lastmod moved, or that are gone (so
 * engines drop them). A page without a lastmod that was already there is left alone: its
 * content may change with every build (live data), which is no reason to recrawl it.
 */
export function changedUrls(before: Entries, after: Entries): string[] {
  const changed = Object.keys(after).filter(
    (url) => !(url in before) || (after[url] !== null && after[url] !== before[url])
  );
  const gone = Object.keys(before).filter((url) => !(url in after));
  return [...changed, ...gone].sort();
}

async function text(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.text();
}

/** Every entry of the live sitemap, through its index. */
async function liveEntries(): Promise<Entries> {
  const index = await text(sitemapUrl);
  const maps = [...index.matchAll(/<sitemap><loc>([^<]*)<\/loc>/g)].map(([, loc = '']) => loc);
  const entries: Entries = {};
  for (const map of maps) Object.assign(entries, sitemapEntries(await text(map)));
  return entries;
}

function builtEntries(): Entries {
  const index = readFileSync(join(dist, 'sitemap-index.xml'), 'utf8');
  const entries: Entries = {};
  for (const [, loc = ''] of index.matchAll(/<sitemap><loc>([^<]*)<\/loc>/g)) {
    const file = join(dist, new URL(loc).pathname.slice(1));
    Object.assign(entries, sitemapEntries(readFileSync(file, 'utf8')));
  }
  return entries;
}

async function ping(urls: string[]): Promise<void> {
  if (urls.length === 0) {
    console.log('indexnow: nothing changed');
    return;
  }
  const { host } = new URL(siteUrl);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host,
      key: indexNowKey,
      keyLocation: `${siteUrl}/${indexNowKey}.txt`,
      urlList: urls,
    }),
    signal: AbortSignal.timeout(timeout),
  });
  // 200 and 202 both mean received; 202 while the key file is still being checked.
  if (response.status !== 200 && response.status !== 202) {
    throw new Error(`IndexNow answered ${response.status}: ${await response.text()}`);
  }
  console.log(`indexnow: sent ${urls.length} URLs (${response.status})\n  ${urls.join('\n  ')}`);
}

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'snapshot' && args[0] !== undefined) {
    try {
      writeFileSync(args[0], JSON.stringify(await liveEntries()));
    } catch (error) {
      console.warn(`indexnow: no snapshot of the live sitemap: ${(error as Error).message}`);
    }
  } else if (command === 'deployed' && args[0] !== undefined) {
    // Best effort: the deploy already happened, so a failure here only logs.
    try {
      const before = JSON.parse(readFileSync(args[0], 'utf8')) as Entries;
      await ping(changedUrls(before, builtEntries()));
    } catch (error) {
      console.warn(`indexnow: skipped (${(error as Error).message}); run \`just indexnow\` later`);
    }
  } else if (command === 'ping') {
    await ping(args.length > 0 ? args : Object.keys(await liveEntries()));
  } else {
    console.error('usage: indexnow.ts snapshot <file> | deployed <file> | ping [url...]');
    process.exit(2);
  }
}
