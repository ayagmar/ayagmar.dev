// Prints one regular expression matching exactly the URLs in the shared fixtures
// (packages/contracts/fixtures). CI builds the site in fixtures mode (ADR 0015), so those
// sample links appear on its pages; whether a sample repository or track still exists says
// nothing about the site, so `just links` excludes them from the external link check.
// Usage: node scripts/fixture-urls.ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function fixtureUrls(dir: string): string[] {
  const urls = new Set<string>();
  const walk = (value: unknown): void => {
    if (typeof value === 'string' && /^https?:\/\//.test(value)) urls.add(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  for (const file of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
    if (!file.endsWith('.json')) continue;
    try {
      walk(JSON.parse(readFileSync(join(dir, file), 'utf8')));
    } catch {
      // Malformed-response fixtures are not JSON on purpose; their URLs are never rendered.
    }
  }
  return [...urls].sort();
}

export function excludePattern(urls: readonly string[]): string {
  const literal = (url: string) => url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return `^(?:${urls.map(literal).join('|')})/?$`;
}

if (import.meta.main) {
  const urls = fixtureUrls(join(import.meta.dirname, '..', 'packages', 'contracts', 'fixtures'));
  // A pattern that matches nothing when there are no fixture URLs.
  console.log(urls.length > 0 ? excludePattern(urls) : '^$');
}
