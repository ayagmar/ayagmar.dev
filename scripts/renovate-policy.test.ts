// Renovate may merge on its own only patch and minor updates (ADR 0020). A pin or digest
// update swaps the code an action or package runs without a reviewed version change, so it
// stays a normal pull request like a major. Run by `just renovate-check` and `just test-scripts`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

interface Rule {
  matchUpdateTypes?: string[];
  automerge?: boolean;
}
const config = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'renovate.json'), 'utf8')
) as {
  automerge?: boolean;
  lockFileMaintenance?: { automerge?: boolean };
  packageRules: Rule[];
};

/** Rules that turn automerge on for an update type. */
const enabling = (type: string) =>
  config.packageRules.filter(
    (rule) =>
      rule.automerge === true && (!rule.matchUpdateTypes || rule.matchUpdateTypes.includes(type))
  );

describe('renovate automerge', () => {
  it('is off unless a rule turns it on', () => {
    assert.equal(config.automerge, false);
    assert.notEqual(config.lockFileMaintenance?.automerge, true);
  });

  for (const type of ['patch', 'minor']) {
    it(`is on for ${type} updates`, () => assert.ok(enabling(type).length > 0));
  }

  for (const type of [
    'major',
    'pin',
    'digest',
    'pinDigest',
    'lockFileMaintenance',
    'rollback',
    'replacement',
    'bump',
  ]) {
    it(`is never turned on for ${type} updates`, () => assert.deepEqual(enabling(type), []));
  }
});
