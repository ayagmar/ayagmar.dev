import { defineCollection } from 'astro:content';
import { glob, type Loader } from 'astro/loaders';
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
    loader: glob({ pattern: '*.md', base: '../../content/writing' }),
    schema: writingSchema,
  }),
  projects: defineCollection({ loader: projects, schema: projectSchema }),
};
