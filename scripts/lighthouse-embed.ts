// Copies scripts/lighthouse-report.js into the lighthouse-comment job of ci.yml, the heredoc
// after `node --input-type=module - render`. That job checks out no code, so the validator it
// runs has to be in the workflow itself. Run after changing lighthouse-report.js;
// scripts/lighthouse-report.test.ts fails while the two differ.
// Usage: node scripts/lighthouse-embed.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const start = /^( *)node --input-type=module - render .* <<'JS'$/;

/** Where the heredoc body sits in the workflow: its line range and indentation. */
function locate(lines: string[]): { from: number; to: number; indent: string } {
  const at = lines.findIndex((line) => start.test(line));
  const indent = start.exec(lines[at] ?? '')?.[1];
  if (indent === undefined)
    throw new Error("ci.yml: no `node --input-type=module - render ... <<'JS'`");
  const end = lines.findIndex((line, i) => i > at && line === `${indent}JS`);
  if (end === -1) throw new Error('ci.yml: the render heredoc has no closing JS line');
  return { from: at + 1, to: end, indent };
}

/** The script embedded in a workflow, as it was in its file. */
export function embedded(workflow: string): string {
  const lines = workflow.split('\n');
  const { from, to, indent } = locate(lines);
  return `${lines
    .slice(from, to)
    .map((line) => line.slice(indent.length))
    .join('\n')}\n`;
}

/** The workflow with `script` as the render heredoc's body. */
export function embed(workflow: string, script: string): string {
  const lines = workflow.split('\n');
  const { from, to, indent } = locate(lines);
  const body = script
    .trimEnd()
    .split('\n')
    .map((line) => (line === '' ? '' : `${indent}${line}`));
  return [...lines.slice(0, from), ...body, ...lines.slice(to)].join('\n');
}

if (import.meta.main) {
  const root = join(import.meta.dirname, '..');
  const workflow = join(root, '.github/workflows/ci.yml');
  const script = readFileSync(join(import.meta.dirname, 'lighthouse-report.js'), 'utf8');
  writeFileSync(workflow, embed(readFileSync(workflow, 'utf8'), script));
  console.log('lighthouse-embed: copied scripts/lighthouse-report.js into ci.yml');
}
