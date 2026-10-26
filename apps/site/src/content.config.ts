import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { writingSchema } from './lib/writing-schema.ts';

export const collections = {
  writing: defineCollection({
    loader: glob({ pattern: '*.md', base: '../../content/writing' }),
    schema: writingSchema,
  }),
};
