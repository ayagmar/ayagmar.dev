import { expect, it } from 'vitest';
import { analyticsToken, cloudflareAnalytics } from '../src/lib/search.ts';

// Catches the gate counting Previews and local builds, or production losing its analytics.
it("gives the beacon a token only on Workers Builds' build of main", () => {
  expect(analyticsToken('main')).toBe(cloudflareAnalytics.token);
  for (const branch of ['feat/x', 'main-2', '', undefined])
    expect(analyticsToken(branch)).toBeUndefined();
});
