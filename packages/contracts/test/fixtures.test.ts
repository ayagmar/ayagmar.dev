// fixtures.ts imports every fixture by hand (workerd has no file system). A file added on disk
// but not there would never be served by the MSW handlers or checked by a normalizer test.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { rawFixtures, snapshotFixtures } from '../src/fixtures.ts';

const root = join(import.meta.dirname, '..', 'fixtures');

it('registers every fixture file in src/fixtures.ts', () => {
  const onDisk: Record<string, Record<string, string[]>> = { raw: {}, snapshot: {} };
  for (const source of readdirSync(root, { withFileTypes: true })) {
    if (!source.isDirectory()) continue;
    for (const kind of readdirSync(join(root, source.name))) {
      const cases = readdirSync(join(root, source.name, kind))
        .filter((file) => file.endsWith('.json'))
        .map((file) => file.slice(0, -'.json'.length));
      onDisk[kind] = { ...onDisk[kind], [source.name]: cases.sort() };
    }
  }
  const registered = (fixtures: Record<string, object>) =>
    Object.fromEntries(
      Object.entries(fixtures).map(([source, cases]) => [source, Object.keys(cases).sort()])
    );

  expect(registered(rawFixtures)).toEqual(onDisk.raw);
  expect(registered(snapshotFixtures)).toEqual(onDisk.snapshot);
});
