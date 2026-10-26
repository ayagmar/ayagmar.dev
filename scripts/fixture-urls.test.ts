import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { excludePattern, fixtureUrls } from './fixture-urls.ts';

const urls = fixtureUrls(join(import.meta.dirname, '..', 'packages', 'contracts', 'fixtures'));
const pattern = new RegExp(excludePattern(urls));

describe('fixture URL exclusion for the link check', () => {
  it('covers the sample links a fixtures-mode build renders', () => {
    // A sample compare link that 404s; it broke the external link check once.
    assert.match('https://github.com/ayagmar/runnerd/compare/3f2a1c0...9be47d2', pattern);
    for (const url of urls) assert.match(url, pattern);
  });

  it('still checks every other link, including longer URLs on the same sites', () => {
    assert.doesNotMatch('https://github.com/ayagmar/ayagmar.dev', pattern);
    assert.doesNotMatch('https://github.com/ayagmar/runnerd/issues', pattern);
    assert.doesNotMatch('https://github.com/ayagmar/runnerdx', pattern);
  });
});
