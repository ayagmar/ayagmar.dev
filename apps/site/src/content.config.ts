import { defineCollection } from 'astro:content';
import { file, glob, type Loader } from 'astro/loaders';
import { aboutSchema } from './data/about.ts';
import { usesSchema } from './data/uses.ts';
import { postArtErrors, writingBase } from './lib/art-files.ts';
import { noctaliaPluginsSchema } from './lib/noctalia-plugins.ts';
import { nowSchema } from './lib/now-schema.ts';
import { projectSchema } from './lib/project-schema.ts';
import { checkProjectFiles } from './lib/projects.ts';
import { skillsSchema } from './lib/skills-schema.ts';
import { tilSchema } from './lib/til-schema.ts';
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

// Render posts during each build instead of reusing HTML from the content cache, which does not
// notice a changed Markdown plugin such as the diagram renderer (ADR 0024).
const writingFiles = glob({ pattern: '*.md', base: writingBase, deferRender: true });

const writing: Loader = {
  name: 'writing',
  load: async (context) => {
    await writingFiles.load(context);
    const posts = [...context.store.values()].map(({ id, data }) => ({ id, art: data.art }));
    const errors = postArtErrors(posts);
    if (errors.length > 0) throw new Error(errors.join('\n'));
  },
};

export const collections = {
  writing: defineCollection({ loader: writing, schema: writingSchema }),
  // Short notes, rendered per build like posts so the diagram renderer runs on each (ADR 0028).
  til: defineCollection({
    loader: glob({ pattern: '*.md', base: '../../content/til', deferRender: true }),
    schema: tilSchema,
  }),
  // One entry, id "now": the /now page (ADR 0035). `updated` is checked against the build's day.
  now: defineCollection({
    loader: glob({ pattern: 'now.md', base: '../../content', deferRender: true }),
    schema: nowSchema(new Date()),
  }),
  projects: defineCollection({ loader: projects, schema: projectSchema }),
  // One entry, id "plugins": the whole list, in its order (the section on /projects).
  noctaliaPlugins: defineCollection({
    loader: file('../../content/noctalia-plugins.json', {
      parser: (text) => ({ plugins: { plugins: JSON.parse(text) } }),
    }),
    schema: noctaliaPluginsSchema,
  }),
  // One entry, id "about": the whole file.
  about: defineCollection({
    loader: file('../../content/about.json', { parser: (text) => ({ about: JSON.parse(text) }) }),
    schema: aboutSchema,
  }),
  // One entry, id "skills": the whole file, written by `just skills-sync` (ADR 0031).
  skills: defineCollection({
    loader: file('../../content/skills.json', { parser: (text) => ({ skills: JSON.parse(text) }) }),
    schema: skillsSchema,
  }),
  // One entry, id "uses": the whole file.
  uses: defineCollection({
    loader: file('../../content/uses.json', { parser: (text) => ({ uses: JSON.parse(text) }) }),
    schema: usesSchema,
  }),
};
