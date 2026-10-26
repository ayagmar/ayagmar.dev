// Writes schema/<name>.input.json and schema/<name>.output.json from the zod schemas.
// With --check, writes nothing and exits 1 when a committed file differs.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { jsonSchemas } from '../src/json-schemas.ts';

const dir = join(import.meta.dirname, '..', 'schema');
const check = process.argv.includes('--check');

const expected = new Map<string, string>();
for (const [name, schema] of Object.entries(jsonSchemas)) {
  for (const io of ['input', 'output'] as const) {
    const json = z.toJSONSchema(schema, { io, target: 'draft-2020-12' });
    expected.set(`${name}.${io}.json`, `${JSON.stringify(json, null, 2)}\n`);
  }
}

const present = readdirSync(dir).filter((file) => file.endsWith('.json'));
const problems: string[] = [];
for (const [file, content] of expected) {
  const path = join(dir, file);
  const current = present.includes(file) ? readFileSync(path, 'utf8') : null;
  if (current === content) continue;
  if (check) problems.push(`${file} is ${current === null ? 'missing' : 'out of date'}`);
  else writeFileSync(path, content);
}
for (const file of present) {
  if (!expected.has(file)) problems.push(`${file} has no schema in src/json-schemas.ts; delete it`);
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`schema/${problem}`);
  if (check) console.error('Run `just contracts-schema` and commit the result.');
  process.exit(1);
}
