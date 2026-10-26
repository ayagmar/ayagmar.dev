// svelte-check cannot resolve .astro files, which tests render with the container API. astro check
// resolves them to their real types and ignores this fallback.
declare module '*.astro' {
  import type { AstroComponentFactory } from 'astro/runtime/server/index.js';

  const component: AstroComponentFactory;
  export default component;
}
