import { expect, it } from 'vitest';
import { changedUrls } from '../scripts/indexnow.ts';

// Catches a deploy pinging every page whose live data changes on each build (no lastmod), or
// missing an edited, new or removed page.
it('pings new, edited and removed pages, and not undated ones that were already there', () => {
  const before = {
    'https://ayagmar.dev/': null,
    'https://ayagmar.dev/writing/a': '2026-10-01',
    'https://ayagmar.dev/writing/b': '2026-10-01',
    'https://ayagmar.dev/til/gone': '2026-09-01',
  };
  const after = {
    'https://ayagmar.dev/': null,
    'https://ayagmar.dev/writing/a': '2026-10-01',
    'https://ayagmar.dev/writing/b': '2026-10-12',
    'https://ayagmar.dev/writing/c': '2026-10-20',
    'https://ayagmar.dev/uses': null,
  };
  expect(changedUrls(before, after)).toEqual([
    'https://ayagmar.dev/til/gone',
    'https://ayagmar.dev/uses',
    'https://ayagmar.dev/writing/b',
    'https://ayagmar.dev/writing/c',
  ]);
});
