import type { D1Migration } from 'cloudflare:test';

declare global {
  namespace Cloudflare {
    interface Env {
      /** Set by vitest.config.ts; applied by test/setup.ts. */
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
