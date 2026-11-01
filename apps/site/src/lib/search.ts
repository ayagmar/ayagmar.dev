/**
 * What the site tells search engines, set in one place. Every value here is public by design: it
 * ships in the HTML or at a public URL.
 */
import { siteUrl } from './site.ts';

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
