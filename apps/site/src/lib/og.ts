/**
 * Link-preview images (Open Graph): where each page's image is and what it shows. The images
 * themselves are drawn at build time by src/lib/og-card.ts, through the endpoints under
 * src/pages/og/.
 */
import { site } from './site.ts';

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
