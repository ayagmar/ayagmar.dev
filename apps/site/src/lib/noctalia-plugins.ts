import { z } from 'astro/zod';
import { contentImage } from './content-images.ts';

/** Where Noctalia installs community plugins from; each plugin is a directory in it. */
const communityPlugins = 'https://github.com/noctalia-dev/community-plugins';

const text = z.string({ error: 'is required' }).trim().min(1, 'must not be empty');

const plugin = z.strictObject({
  /** Its directory in noctalia-dev/community-plugins, which is also the id after `ayagmar/`. */
  directory: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a directory like "obs-control"'),
  /** `name` from its plugin.toml, as Noctalia lists it. */
  name: text,
  summary: text,
  /** The plugin's thumbnail.webp from its directory, shown beside its row (ADR 0048). */
  thumbnail: contentImage('plugins').optional(),
  /** The plugin's screenshot.png from its directory, which its thumbnail opens (ADR 0049). */
  screenshot: z
    .strictObject({
      alt: text,
      image: contentImage('plugins'),
    })
    .optional(),
});

/**
 * content/noctalia-plugins.json: the owner's plugins in Noctalia's community list, in the order /projects
 * shows them. Directories in someone else's repository, not featured projects: no numbers, log
 * or page of their own.
 */
export const noctaliaPluginsSchema = z.strictObject({
  plugins: z
    .array(plugin)
    .refine((plugins) => new Set(plugins.map((entry) => entry.directory)).size === plugins.length, {
      message: 'must not repeat a directory',
    }),
});

export type NoctaliaPlugin = z.output<typeof plugin>;

export const pluginUrl = ({ directory }: NoctaliaPlugin) =>
  `${communityPlugins}/tree/main/${directory}`;

/**
 * The section after the project groups on /projects and in its text copy. `id` is its anchor, the
 * target of the site Worker's redirect from /projects/headroom (ADR 0047).
 */
export const pluginsSection = {
  id: 'noctalia-plugins',
  title: 'Noctalia plugins',
  intro: 'Plugins I wrote for the Noctalia shell. You install them from its community plugin list.',
};
