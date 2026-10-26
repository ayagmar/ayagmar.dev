import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { writingSchema } from './lib/writing-schema.ts';

export const collections = {
  writing: defineCollection({
    // Render posts during each build instead of reusing HTML from the content cache, which
    // does not notice a changed Markdown plugin such as the diagram renderer (ADR 0024).
    loader: glob({ pattern: '*.md', base: '../../content/writing', deferRender: true }),
    schema: writingSchema,
  }),
};
