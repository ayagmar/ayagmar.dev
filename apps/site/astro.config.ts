import { satteri } from '@astrojs/markdown-satteri';
import sitemap from '@astrojs/sitemap';
import svelte from '@astrojs/svelte';
import { defineConfig, envField } from 'astro/config';
import { diagrams } from './src/lib/markdown/diagrams.ts';
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
  // ```mermaid fences become inline SVG at build time (ADR 0024).
  markdown: { syntaxHighlight: false, processor: satteri({ hastPlugins: [diagrams] }) },
  integrations: [svelte(), sitemap()],
  env: {
    schema: {
      COMMIT_SHA: envField.string({ context: 'server', access: 'public', default: 'dev' }),
      PUBLIC_SHOW_DRAFTS: envField.string({ context: 'server', access: 'public', default: '' }),
    },
  },
});
