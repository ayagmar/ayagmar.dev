import { defineConfig, devices } from '@playwright/test';

const port = 8790;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  workers: 4,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://127.0.0.1:${port}` },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // The built site through its real Worker, as Cloudflare serves it.
  webServer: {
    command: `pnpm exec wrangler dev --port ${port} --ip 127.0.0.1 --log-level warn`,
    url: `http://127.0.0.1:${port}/index.txt`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
