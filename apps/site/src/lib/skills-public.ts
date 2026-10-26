// What may be published about a skill, as plain values with no imports so both the sync script
// (scripts/skills-sync.ts) and the build schema (skills-schema.ts) apply the same rules (ADR 0031).

/** Models whose names an eval line may show. A private alias fails the sync instead of shipping. */
export const publicModels = [
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-haiku-5-5',
  'claude-fable-5-1',
] as const;

export const semver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const start = String.raw`(?:^|[\s"'(=,;])`;
const localPaths: [string, RegExp][] = [
  ['an absolute path', new RegExp(`${start}/(?!/)[\\w.@~-]+/[\\w.@~/-]*`)],
  ['a Windows path', new RegExp(`${start}[A-Za-z]:[\\\\/]`)],
  ['a network path', new RegExp(`${start}\\\\\\\\[\\w.-]+\\\\`)],
  ['a ~/ path', new RegExp(`${start}~/`)],
];

/** What kind of local path a text value holds, or null. Run it on decoded values, not JSON. */
export function localPath(value: string): string | null {
  return localPaths.find(([, pattern]) => pattern.test(value))?.[0] ?? null;
}
