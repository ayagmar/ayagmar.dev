import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { usesSchema } from '../src/data/uses.ts';

const text = readFileSync(new URL('../../../content/uses.json', import.meta.url), 'utf8');

it('content/uses.json matches its schema', () => {
  expect(usesSchema.safeParse(JSON.parse(text)).error).toBeUndefined();
});

// The hardware list is copied from the machines by hand (ADR 0032). Catches a pasted command
// output that carries an identifier: a serial-looking token, a UUID, a MAC, a device or mount
// path, or a hostname.
it('content/uses.json holds no machine identifiers', () => {
  const values: string[] = [];
  JSON.parse(text, (_key, value) => {
    if (typeof value === 'string') values.push(value);
    return value;
  });
  for (const value of values) {
    expect(value).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(value).not.toMatch(/\b[0-9a-f]{2}(?::[0-9a-f]{2}){5}\b/i);
    expect(value).not.toMatch(/(?:^|\s)\/(?:dev|home|mnt|media|run)\b|\bnvme\dn\d|\bsd[a-z]\d?\b/);
    expect(value).not.toMatch(/\b(?:serial|s\/n|hostname|uuid)\b/i);
    expect(value).not.toMatch(/\b[A-Z0-9]{12,}\b/);
  }
});
