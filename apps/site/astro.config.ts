import { satteri } from '@astrojs/markdown-satteri';
import sitemap from '@astrojs/sitemap';
import svelte from '@astrojs/svelte';
import { defineConfig, envField } from 'astro/config';
import { diagrams } from './src/lib/markdown/diagrams.ts';
import { scopeIds } from './src/lib/markdown/scope-ids.ts';
import { scrollable } from './src/lib/markdown/scrollable.ts';
import { siteUrl } from './src/lib/site.ts';

export default defineConfig({
  site: siteUrl,
  output: 'static',
  trailingSlash: 'never',
  build: {
    // One HTML file per page (`/writing` -> writing.html): no trailing-slash redirects.
    format: 'file',
    // External stylesheets only, so the CSP needs no style hashes beyond Astro's island style.
    inlineStylesheets: 'never',
  },
  // Shiki writes style="" attributes, which the CSP forbids. A highlighter that emits
  // classes can be added with the visual design.
  // ```mermaid fences become inline SVG at build time (ADR 0024); then the code blocks and tables
  // left get tabindex so their sideways scroll works from the keyboard.
  markdown: {
    syntaxHighlight: false,
    processor: satteri({ hastPlugins: [scopeIds, diagrams, scrollable] }),
  },
  integrations: [svelte(), sitemap()],
  // Never inline a script or asset into the page: the CSP has no `data:` and allows no inline
  // script except Astro's own (ADR 0019), so the home page's room script stays a file (ADR 0027).
  vite: { build: { assetsInlineLimit: 0 } },
  env: {
    schema: {
      COMMIT_SHA: envField.string({ context: 'server', access: 'public', default: 'dev' }),
      PUBLIC_SHOW_DRAFTS: envField.string({ context: 'server', access: 'public', default: '' }),
      // Where pages get source data at build time (ADR 0015). Workers Builds sets `api`.
      SIGNALS_MODE: envField.enum({
        context: 'server',
        access: 'public',
        values: ['fixtures', 'api'],
        default: 'fixtures',
      }),
      // The branch Workers Builds is building: a Preview's link previews point at the Preview
      // (src/lib/og.ts). Unset outside Workers Builds, which means production.
      WORKERS_CI_BRANCH: envField.string({ context: 'server', access: 'public', default: '' }),
      SIGNALS_API_BASE: envField.string({
        context: 'server',
        access: 'public',
        url: true,
        default: 'https://api.ayagmar.dev',
      }),
    },
  },
});
