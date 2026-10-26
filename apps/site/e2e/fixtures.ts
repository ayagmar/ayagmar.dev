import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test as base, expect } from '@playwright/test';

const dist = join(import.meta.dirname, '..', 'dist');

/** Every page in the sitemap, as paths. */
export const pages = [
  ...readFileSync(join(dist, 'sitemap-0.xml'), 'utf8').matchAll(
    /<loc>https:\/\/ayagmar\.dev([^<]*)<\/loc>/g
  ),
].map(([, path]) => path || '/');

/** Every feed the build wrote. */
export const feeds = readdirSync(dist, { recursive: true, encoding: 'utf8' })
  .filter((file) => /(^|\/)(feed|atom)\.xml$/.test(file))
  .map((file) => `/${file}`);

export const notFoundPath = '/this-page-does-not-exist';

declare global {
  interface Window {
    cspViolations: string[];
  }
}

/** Fails any test whose page reports a Content-Security-Policy violation. */
export const test = base.extend<{ cspGuard: undefined }>({
  cspGuard: [
    async ({ page }, use) => {
      const console: string[] = [];
      page.on('console', (message) => {
        if (/Content.Security.Policy/i.test(message.text())) console.push(message.text());
      });
      await page.addInitScript(() => {
        window.cspViolations = [];
        document.addEventListener('securitypolicyviolation', (event) => {
          window.cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`);
        });
      });
      await use(undefined);
      const reported = page.url().startsWith('http')
        ? await page.evaluate(() => window.cspViolations ?? [])
        : [];
      expect([...reported, ...console], 'CSP violations').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
