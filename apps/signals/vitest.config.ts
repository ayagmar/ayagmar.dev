import { join } from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Obviously fake secrets, 32+ characters like the real ones.
const fakeSecrets = {
  PUSH_TOKEN_LLM_USAGE: 'test-llm-usage-token-0000000000000000',
  PUSH_TOKEN_LLM_USAGE_NEXT: 'test-llm-usage-token-next-00000000000',
  PUSH_TOKEN_TRELLIS: 'test-trellis-token-000000000000000000',
  PUSH_TOKEN_TRELLIS_NEXT: 'test-trellis-token-next-0000000000000',
  PUSH_HMAC_TRELLIS: 'test-trellis-hmac-key-00000000000000',
  PUSH_HMAC_TRELLIS_NEXT: 'test-trellis-hmac-key-next-000000000',
  PUSH_TOKEN_DESKTOP: 'test-desktop-token-000000000000000000',
  PUSH_TOKEN_DESKTOP_NEXT: 'test-desktop-token-next-0000000000000',
};

// The limiter is real; this only raises its limit so the suite never trips it by accident.
// The rate-limit test drives the limiter's answer directly.
const ratelimits = {
  PUSH_RATE_LIMIT: { namespace_id: 'test', simple: { limit: 100_000, period: 60 as const } },
};

export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      remoteBindings: false,
      miniflare: {
        bindings: {
          COMMIT_SHA: 'test-sha',
          ...fakeSecrets,
          TEST_MIGRATIONS: await readD1Migrations(join(import.meta.dirname, 'migrations')),
        },
        ratelimits,
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
  },
}));
