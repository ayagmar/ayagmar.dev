import { defineCollection } from 'astro:content';
import { file, glob, type Loader } from 'astro/loaders';
import { aboutSchema } from './data/about.ts';
import { projectSchema } from './lib/project-schema.ts';
import { checkProjectFiles } from './lib/projects.ts';
import { writingSchema } from './lib/writing-schema.ts';

// Ids are file names, so a file whose `slug` differs from its name is caught below instead of
// silently replacing another project's entry.
const projectFiles = glob({
  pattern: '*.md',
  base: '../../content/projects',
  generateId: ({ entry }) => entry.replace(/\.md$/, ''),
});

const projects: Loader = {
  name: 'projects',
  load: async (context) => {
    await projectFiles.load(context);
    const files = [...context.store.values()].map((entry) => ({
      id: entry.id,
      slug: String(entry.data.slug),
    }));
    const { errors, missing } = checkProjectFiles(files);
    if (errors.length > 0) throw new Error(errors.join('\n'));
    if (missing.length > 0) {
      context.logger.warn(
        `No content/projects/<slug>.md for ${missing.join(', ')}; their pages show GitHub data only.`
      );
    }
  },
};

export const collections = {
  writing: defineCollection({
    // Render posts during each build instead of reusing HTML from the content cache, which
    // does not notice a changed Markdown plugin such as the diagram renderer (ADR 0024).
    loader: glob({ pattern: '*.md', base: '../../content/writing', deferRender: true }),
    schema: writingSchema,
  }),
  projects: defineCollection({ loader: projects, schema: projectSchema }),
  // One entry, id "about": the whole file.
  about: defineCollection({
    loader: file('../../content/about.json', { parser: (text) => ({ about: JSON.parse(text) }) }),
    schema: aboutSchema,
  }),
};
