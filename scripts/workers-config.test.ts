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

// A Preview runs untrusted branch code with public URLs, so it must never reach production
// data, and the preview database its migrations go to must be the one Previews bind.
describe('signals previews', () => {
  const read = (file: string) => {
    const path = join(apps, 'signals', file);
    const { config, error } = ts.parseConfigFileTextToJson(path, readFileSync(path, 'utf8'));
    assert.equal(error, undefined);
    return config;
  };
  const main = read('wrangler.jsonc');
  const migrations = read('wrangler.preview-migrations.jsonc');
  const ids = (list: { database_id: string }[] = []) => list.map((db) => db.database_id);

  it('bind no production database or rate limit namespace', () => {
    for (const id of ids(main.previews.d1_databases)) {
      assert.ok(!ids(main.d1_databases).includes(id), `preview binds production database ${id}`);
    }
    const production = new Set(
      main.ratelimits.map((r: { namespace_id: string }) => r.namespace_id)
    );
    for (const { namespace_id } of main.previews.ratelimits) {
      assert.ok(!production.has(namespace_id), `preview shares rate limit ${namespace_id}`);
    }
  });

  it('migrate the database they bind', () => {
    assert.deepEqual(ids(migrations.d1_databases), ids(main.previews.d1_databases));
  });
});
