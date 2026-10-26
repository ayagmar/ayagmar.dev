/// <reference types="vitest/config" />
import { getViteConfig } from 'astro/config';

// Astro's Vite config, so tests can render .astro components with the container API. The root
// is explicit so tools that load this file from the repo root (knip) find the site.
export default getViteConfig(
  { test: { include: ['test/**/*.test.ts'] } },
  { root: import.meta.dirname }
);
