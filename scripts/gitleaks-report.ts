// Runs gitleaks and prints each finding as file, line and rule only. gitleaks' own verbose
// output redacts the secret it recognised but prints the rest of the match, which can hold
// another credential; here its output is discarded and only those fields are read back from
// a redacted JSON report.
// Usage: node scripts/gitleaks-report.ts git|dir <path>
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface Finding {
  File: string;
  StartLine: number;
  RuleID: string;
  Commit?: string;
}

const [mode, path] = process.argv.slice(2);
if ((mode !== 'git' && mode !== 'dir') || !path) {
  console.error('usage: node scripts/gitleaks-report.ts git|dir <path>');
  process.exit(2);
}

const dir = mkdtempSync(join(tmpdir(), 'min7-gitleaks-'));
const report = join(dir, 'report.json');
try {
  const result = spawnSync(
    'gitleaks',
    [mode, path, '--redact=100', '--no-banner', '--report-format', 'json', '--report-path', report],
    { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] }
  );
  if (result.status !== 0 && result.status !== 1) {
    // Not a finding: gitleaks could not run. Its own error says why.
    console.error(result.error?.message ?? result.stderr);
    process.exit(2);
  }
  const findings = JSON.parse(readFileSync(report, 'utf8')) as Finding[];
  for (const { File, StartLine, RuleID, Commit } of findings) {
    const where = Commit ? ` (commit ${Commit.slice(0, 12)})` : '';
    console.error(`${File}:${StartLine}: ${RuleID} (gitleaks)${where}`);
  }
  if (findings.length > 0) {
    console.error(`gitleaks: ${findings.length} possible secrets in ${path}`);
    process.exit(1);
  }
  console.log(`gitleaks: no secrets in ${path}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
