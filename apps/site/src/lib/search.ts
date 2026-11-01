/**
 * What the site tells search engines and Cloudflare Web Analytics, set in one place. Every value
 * here is public by design: it ships in the HTML or at a public URL.
 */
import { siteUrl } from './site.ts';

/**
 * Cloudflare Web Analytics (ADR 0019): Cloudflare's own beacon, no cookies. Production only, so
 * Previews, local builds and the e2e builds count nothing. An empty token renders nothing.
 */
export const cloudflareAnalytics = {
  token: '24faa6c8353f473c86d534426345ee6a',
  /** The one third-party script the site loads (CSP script-src, budgets.json). */
  script: 'https://static.cloudflareinsights.com/beacon.min.js',
  /** Where the beacon sends its report (CSP connect-src). */
  reportOrigin: 'https://cloudflareinsights.com',
} as const;

/**
 * The beacon's token for this build, or undefined for no beacon: only Workers Builds' build of
 * `main` is production. `branch` is WORKERS_CI_BRANCH, unset outside Workers Builds.
 */
export function analyticsToken(branch: string | undefined): string | undefined {
  const token: string = cloudflareAnalytics.token;
  return branch === 'main' && token !== '' ? token : undefined;
}

/**
 * Ownership tokens for Google Search Console and Bing Webmaster Tools, rendered as `<meta>` tags
 * on every page when set (docs/seo.md). Empty renders nothing.
 */
export const siteVerification = {
  google: '',
  bing: '',
} as const;

/**
 * The IndexNow key (https://www.indexnow.org/documentation), served at `/<key>.txt` to prove the
 * pings in scripts/indexnow.ts come from the site. Public by design, so gitleaks may pass it.
 */
export const indexNowKey = '58c6364f0d560ae324538e4956c1a1f5'; // gitleaks:allow

export const sitemapUrl = new URL('/sitemap-index.xml', siteUrl).href;
