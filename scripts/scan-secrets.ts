// Fails when built output (the site's dist/, the signals bundle) contains something shaped like
// a secret: a value inlined at build time from the environment, a key copied into a public
// asset. gitleaks covers the git history; this covers what would be deployed. Each hit prints
// the file, line and rule only, never the matched text, so CI logs cannot leak it.
// Usage: node scripts/scan-secrets.ts <dir>...
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

interface Rule {
  id: string;
  pattern: RegExp;
  /** Further check on the captured value (group 1), for patterns that alone match too much. */
  accept?: (value: string) => boolean;
}

/** Bits per character: random tokens score above 4, words and identifiers well below. */
export function entropy(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

const assignment = String.raw`["']?\s*[:=]\s*["'\x60]`;

export const rules: readonly Rule[] = [
  { id: 'private-key', pattern: /-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----/g },
  { id: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g },
  { id: 'github-fine-grained-token', pattern: /\bgithub_pat_\w{82}\b/g },
  // cfk_, cfut_, cfat_: API keys and tokens; cfoat_: Wrangler OAuth; cfast_: Access service
  // token secrets. Each is 40 characters and a checksum.
  { id: 'cloudflare-token', pattern: /\bcf(?:k|ut|at|oat|ast)_[A-Za-z0-9]{40,}\b/g },
  // Tokens and keys from before the prefixed format, next to a Cloudflare name.
  {
    id: 'cloudflare-legacy-token',
    pattern: new RegExp(
      String.raw`(?:cloudflare|\bcf)[\w.-]{0,30}?(?:token|key|secret)${assignment}([A-Za-z0-9_-]{40}|[a-f0-9]{37,45})["'\x60]`,
      'gi'
    ),
  },
  { id: 'aws-access-key', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { id: 'slack-token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { id: 'npm-token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
  // `secret = "..."`, `apiKey: '...'` and the like with a random-looking value.
  {
    id: 'high-entropy-assignment',
    pattern: new RegExp(
      String.raw`(?:secret|token|passw(?:or)?d|api[_-]?key|access[_-]?key|private[_-]?key|credential|auth)\w*${assignment}([A-Za-z0-9+/=_.-]{20,200})["'\x60]`,
      'gi'
    ),
    // Random tokens mix digits and letters; alphabets and prose do not.
    accept: (value) => /\d/.test(value) && /[A-Za-z]/.test(value) && entropy(value) >= 4,
  },
];

export interface Finding {
  file: string;
  line: number;
  rule: string;
}

function* files(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (entry.isFile()) yield path;
  }
}

export function scan(dirs: readonly string[]): Finding[] {
  const findings: Finding[] = [];
  for (const dir of dirs) {
    if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`${dir} is not a directory; build it first`);
    }
    for (const file of files(dir)) {
      // Every file, binary ones too: a WebAssembly data section, image metadata or a PDF can
      // carry a token. latin1 maps each byte to one character, so the ASCII patterns match
      // the same bytes in text and binary files.
      const lines = readFileSync(file, 'latin1').split('\n');
      lines.forEach((text, index) => {
        for (const rule of rules) {
          // Every pattern has the g flag; matchAll copies it, so no state carries over.
          const hit = [...text.matchAll(rule.pattern)].some(
            (match) => !rule.accept || rule.accept(match[1] ?? match[0])
          );
          if (hit) findings.push({ file: relative('.', file), line: index + 1, rule: rule.id });
        }
      });
    }
  }
  return findings;
}

if (import.meta.main) {
  const dirs = process.argv.slice(2);
  if (dirs.length === 0) {
    console.error('usage: node scripts/scan-secrets.ts <dir>...');
    process.exit(2);
  }
  const findings = scan(dirs);
  for (const { file, line, rule } of findings) console.error(`${file}:${line}: ${rule}`);
  if (findings.length > 0) {
    console.error(`scan-secrets: ${findings.length} possible secrets in ${dirs.join(', ')}`);
    process.exit(1);
  }
  console.log(`scan-secrets: no secrets in ${dirs.join(', ')}`);
}
