// One payload corpus, run through the zod schema and the exported JSON Schema, so producers
// and consumers in other languages get the same answers as the TypeScript code.
//   corpus/<schema>/accept/*.json   every validator must accept
//   corpus/<schema>/reject/*.json   every validator must reject
// Shared fixtures that are valid payloads join the corpus where they are (see `fixtureCases`).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { fixturesCapturedAt } from '../src/fixtures.ts';
import { jsonSchemas } from '../src/json-schemas.ts';

const root = join(import.meta.dirname, '..');
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const jsonFiles = (dir: string) =>
  existsSync(dir) ? readdirSync(dir).filter((file) => file.endsWith('.json')) : [];

type Kind = 'accept' | 'reject';

// Fixtures read in place rather than copied into corpus/. A raw upstream fixture records
// `{ status, body }`; its body is the payload.
const fixtureCases: Record<string, Partial<Record<Kind, string[]>>> = {
  listening: { accept: ['listening/snapshot'] },
  shipping: { accept: ['shipping/snapshot'] },
  projects: { accept: ['projects/snapshot'] },
  // weather's exported schema is its whole envelope; its snapshots join as fresh responses.
  weather: { accept: ['weather/snapshot'] },
  'repo-pulse-feed': {
    accept: ['repo-pulse/raw/ok.json', 'repo-pulse/raw/empty.json'],
    reject: ['repo-pulse/raw/malformed.json'],
  },
  // Push bodies are also the Worker's intake fixtures.
  'push-llm-usage': { accept: ['llm-usage/push/accept'], reject: ['llm-usage/push/reject'] },
  'push-trellis': { accept: ['trellis/push/accept'], reject: ['trellis/push/reject'] },
};

// Sources whose exported schema is the whole read API envelope rather than its `data`.
const envelopes = new Set(['weather']);

const fixturePayloads = (name: string, path: string) => {
  const full = join(root, 'fixtures', path);
  const files = path.endsWith('.json') ? [full] : jsonFiles(full).map((file) => join(full, file));
  return files.map((file) => {
    const json = readJson(file) as { body?: unknown };
    const payload = file.includes('/raw/') ? json.body : json;
    return [
      `fixtures/${relative(join(root, 'fixtures'), file)}`,
      envelopes.has(name)
        ? { source: name, version: 1, fetchedAt: fixturesCapturedAt, stale: false, data: payload }
        : payload,
    ] as const;
  });
};

const cases = (name: string, kind: Kind) => {
  const dir = join(root, 'corpus', name, kind);
  return [
    ...jsonFiles(dir).map((file) => [file, readJson(join(dir, file))] as const),
    ...(fixtureCases[name]?.[kind] ?? []).flatMap((path) => fixturePayloads(name, path)),
  ];
};

// Formats are not asserted: the schemas carry a pattern for every timestamp, and validators
// in other languages differ on formats.
const compile = (path: string) =>
  new Ajv2020({ strict: true, validateFormats: false }).compile(readJson(path) as object);

for (const [name, schema] of Object.entries(jsonSchemas)) {
  describe(`${name} contract`, () => {
    const producer = compile(join(root, 'schema', `${name}.input.json`));
    const consumer = compile(join(root, 'schema', `${name}.output.json`));
    const accepted = cases(name, 'accept');
    const rejected = cases(name, 'reject');

    it('has a corpus with both kinds of case', () => {
      expect(accepted.length).toBeGreaterThan(0);
      expect(rejected.length).toBeGreaterThan(0);
    });

    it.each(accepted)('accepts %s everywhere', (_file, payload) => {
      const parsed = schema.safeParse(payload);
      expect(parsed.error).toBeUndefined();
      expect(producer(payload), JSON.stringify(producer.errors)).toBe(true);
      // A consumer sees what the Worker emits, and must not break on fields added within v1.
      expect(consumer(parsed.data), JSON.stringify(consumer.errors)).toBe(true);
      expect(consumer(payload), JSON.stringify(consumer.errors)).toBe(true);
    });

    it.each(rejected)('rejects %s everywhere', (_file, payload) => {
      expect(schema.safeParse(payload).success).toBe(false);
      expect(producer(payload)).toBe(false);
      expect(consumer(payload)).toBe(false);
    });

    // The consumer schema as v1 first shipped it. Never regenerate this file: if current
    // output stops validating against it, the change is breaking and belongs in /v2/.
    const frozen = join(import.meta.dirname, 'frozen', 'v1', `${name}.output.json`);
    it.runIf(existsSync(frozen)).each(accepted)(
      'still parses %s with the frozen v1 consumer',
      (_file, payload) => {
        const v1 = compile(frozen);
        expect(v1(schema.parse(payload)), JSON.stringify(v1.errors)).toBe(true);
        expect(v1(payload), JSON.stringify(v1.errors)).toBe(true);
      }
    );

    it('has a frozen v1 consumer schema', () => {
      expect(existsSync(frozen)).toBe(true);
    });
  });
}
