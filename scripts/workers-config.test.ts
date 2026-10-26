// `wrangler preview` (the Workers Builds command for every non-production branch) refuses a
// config without a `previews` block, or with Wrangler's `<REPLACE_ME>` placeholders in it
// (`ensurePreviewsConfig` in wrangler 4.152). Production deploys and `wrangler dev` never
// check this, so it is checked here without deploying.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import ts from 'typescript';

const apps = join(import.meta.dirname, '..', 'apps');
const configs = readdirSync(apps).map((app) => join(apps, app, 'wrangler.jsonc'));

describe('wrangler configs', () => {
  for (const file of configs) {
    it(`${file.slice(apps.length + 1)} can be deployed as a Preview`, () => {
      const { config, error } = ts.parseConfigFileTextToJson(file, readFileSync(file, 'utf8'));
      assert.equal(error, undefined);
      assert.equal(typeof config.previews, 'object', 'needs a "previews" block, even an empty one');
      assert.doesNotMatch(JSON.stringify(config.previews), /<REPLACE_ME>/);
    });
  }
});
