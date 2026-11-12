import type { ImageMetadata } from 'astro';
import { z } from 'astro/zod';

/**
 * Images that belong to an entry in content/: a certification's badge, a plugin's thumbnail, a
 * project's screenshot (ADR 0049). Each is downloaded once and committed under src/assets/, since
 * the CSP allows images from the site alone; the build turns it into WebP at the sizes the page
 * shows (ADR 0048).
 */
const folders = {
  badges: import.meta.glob<ImageMetadata>('../assets/badges/*', { eager: true, import: 'default' }),
  plugins: import.meta.glob<ImageMetadata>('../assets/plugins/*', {
    eager: true,
    import: 'default',
  }),
  projects: import.meta.glob<ImageMetadata>('../assets/projects/*', {
    eager: true,
    import: 'default',
  }),
};

export type ImageFolder = keyof typeof folders;

const path = (folder: ImageFolder, file: string) => `src/assets/${folder}/${file}`;

/**
 * An image field in content/: the file under src/assets/<folder>/, and where and when it was
 * fetched, so it can be fetched again from the same place.
 */
export const contentImage = (folder: ImageFolder) =>
  z
    .strictObject({
      file: z
        .string()
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*\.(?:png|webp|jpg)$/, 'must be a file name like "x.png"'),
      source: z.url({ protocol: /^https$/, error: 'must be an https:// URL' }),
      fetched: z.iso.date({ error: 'must be a date like 2026-11-12' }),
    })
    .refine(({ file }) => `../assets/${folder}/${file}` in folders[folder], {
      path: ['file'],
      error: ({ input }) =>
        `${path(folder, (input as { file: string }).file)} does not exist; add the file or drop the field`,
    });

/**
 * The built image for a field. The content cache keeps an entry whose JSON has not changed, so a
 * file deleted on its own passes the schema; this stops the build instead of drawing a broken
 * image.
 */
export function imageFor(folder: ImageFolder, file: string): ImageMetadata {
  const image = folders[folder][`../assets/${folder}/${file}`];
  if (image === undefined) throw new Error(`${path(folder, file)} does not exist`);
  return image;
}
