import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { test as base, expect, type Page } from '@playwright/test';

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

/** Fails unless axe finds no WCAG 2.2 AA or best-practice violation on the page or in `include`. */
export async function expectNoAxeViolations(page: Page, include?: string) {
  const axe = new AxeBuilder({ page }).withTags([
    'wcag2a',
    'wcag2aa',
    'wcag21a',
    'wcag21aa',
    'wcag22aa',
    'best-practice',
  ]);
  if (include) axe.include(include);
  // Home's entrance fades its text in, and axe would measure the contrast of a half-faded line.
  await page.evaluate(() =>
    Promise.allSettled(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished)
    )
  );
  const { violations } = await axe.analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.length} nodes`)).toEqual([]);
}

export { expect };
