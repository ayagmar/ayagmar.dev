/**
 * Link-preview images (Open Graph): where each page's image is and what it shows. The images
 * themselves are drawn at build time by src/lib/og-card.ts, through the endpoints under
 * src/pages/og/.
 */
import { site, siteUrl } from './site.ts';

/**
 * Where this build is served, for the absolute URLs in a link preview (`og:url`, `og:image`):
 * production for `main` and for builds outside Workers Builds, and the branch's Preview for any
 * other branch, so a Preview's card shows the Preview's image, which production may not have
 * yet. `wrangler preview` names the Preview after `WORKERS_CI_BRANCH`, and its URL is
 * `<name>-<worker>.<subdomain>.workers.dev`, the name lowercased with every run of other
 * characters as one hyphen (as `renovate/renovate-44.x` became `renovate-renovate-44-x`). A
 * name too long for one DNS label falls back to production, since that URL cannot exist.
 * The worker and subdomain are the ones `.github/workflows/preview-links.yml` uses.
 */
export function buildOrigin(branch: string | undefined): string {
  if (!branch || branch === 'main') return siteUrl;
  const name = branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const label = `${name}-min7-site`;
  return name !== '' && label.length <= 63 ? `https://${label}.ayagmar.workers.dev` : siteUrl;
}

export const ogSize = { width: 1200, height: 630 } as const;

/** What a page's link preview shows: the image's path on the site and its text alternative. */
export interface OgImage {
  path: string;
  alt: string;
}

export const defaultOgImage: OgImage = {
  path: '/og/default.png',
  alt: `${site.name}: a pixel-art desk at night in Morocco, the lamp on and an arched window over the rooftops.`,
};

export const postOgImage = (slug: string, title: string, art: boolean): OgImage => ({
  path: `/og/writing/${slug}.png`,
  alt: `${title}, on ${site.name}, ${art ? "under the post's art" : 'under the night room'}.`,
});

export const noteOgImage = (slug: string, title: string): OgImage => ({
  path: `/og/til/${slug}.png`,
  alt: `TIL: ${title}, on ${site.name}, under the night room.`,
});
