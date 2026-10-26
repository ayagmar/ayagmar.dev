import { defineConfig, devices } from '@playwright/test';

const port = 8790;
// The build that shows drafts, so the notes in content/til have pages to test (ADR 0028).
const previewPort = 8791;
const previewDir = 'node_modules/.cache/preview';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  workers: 4,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://127.0.0.1:${port}` },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /til-preview/ },
    {
      name: 'til-preview',
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${previewPort}` },
      testMatch: /til-preview/,
    },
  ],
  // The built site through its real Worker, as Cloudflare serves it, and the build that shows
  // drafts through the same Worker.
  webServer: [
    {
      command: `pnpm exec wrangler dev --port ${port} --ip 127.0.0.1 --log-level warn`,
      url: `http://127.0.0.1:${port}/index.txt`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `just site-build-preview && pnpm exec wrangler dev --assets ${previewDir} --port ${previewPort} --ip 127.0.0.1 --log-level warn`,
      url: `http://127.0.0.1:${previewPort}/index.txt`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
