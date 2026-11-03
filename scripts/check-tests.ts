// Fails on tests that cannot fail or that hide failures (ADR 0039): a test with no assertion,
// one whose only assertions are mock-call matchers or toBeDefined/toBeTruthy/not.toBeNull, a
// focused test (`.only`), and a skipped test with neither a reason nor a condition. A finding
// stays only with `// check-tests: allow <reason>` on its line or the line above.
// Usage: node scripts/check-tests.ts [repo-root]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

export interface Finding {
  line: number;
  message: string;
}

const testFile = /\.(?:test|spec)\.[cm]?[jt]s$/;
const runners = new Set(['test', 'it', 'describe', 'suite']);
// Parts of a call chain that still define one test: `it.each(rows)(...)`, `test.only(...)`.
const testModifiers = new Set([
  'only',
  'skip',
  'fixme',
  'concurrent',
  'sequential',
  'serial',
  'each',
  'for',
  'fails',
  'skipIf',
  'runIf',
]);
// `expect.*` calls that set up or match rather than assert.
const notAssertions = new Set([
  'assertions',
  'hasAssertions',
  'extend',
  'addSnapshotSerializer',
  'any',
  'anything',
  'objectContaining',
  'arrayContaining',
  'stringContaining',
  'stringMatching',
  'closeTo',
  'configure',
]);
const chainModifiers = new Set(['not', 'resolves', 'rejects']);
const mockOnly = /Called|Returned|\.mock\.(?:calls|results|callCount)/;
const allow = /\/\/\s*check-tests: allow\s+\S/;

type Kind = 'strong' | 'mock' | 'weak';

// The names along a callee: `test.describe.only` → [test, describe, only]. Through calls, so
// `it.each(rows)` → [it, each]; without them, `expect(x).toBe` has none.
function calleePath(expression: ts.Expression, throughCalls: boolean): string[] | undefined {
  if (ts.isIdentifier(expression)) return [expression.text];
  if (ts.isPropertyAccessExpression(expression)) {
    const left = calleePath(expression.expression, throughCalls);
    return left && [...left, expression.name.text];
  }
  if (throughCalls && ts.isCallExpression(expression)) {
    return calleePath(expression.expression, throughCalls);
  }
  return undefined;
}

const isFunction = (node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression =>
  ts.isArrowFunction(node) || ts.isFunctionExpression(node);

// The matcher an `expect(...)` call ends in, and whether `.not` is on the way; undefined for a
// bare `expect(x)`, which asserts nothing.
function matcherOf(subject: ts.CallExpression): { name: string; not: boolean } | undefined {
  let node: ts.Node = subject;
  let not = false;
  while (ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node) {
    const name = node.parent.name.text;
    const call = node.parent.parent;
    if (chainModifiers.has(name) && !ts.isCallExpression(call)) {
      not ||= name === 'not';
      node = node.parent;
      continue;
    }
    return ts.isCallExpression(call) && call.expression === node.parent ? { name, not } : undefined;
  }
  return undefined;
}

function assertionKind(
  call: ts.CallExpression,
  path: string[],
  sourceFile: ts.SourceFile,
  helpers: Set<string>
): Kind | undefined {
  const [root] = path;
  if (root === undefined) return undefined;
  if (root === 'expect') {
    if (path.length > 2) return undefined;
    if (path[1] !== undefined && path[1] !== 'soft' && path[1] !== 'poll') {
      return notAssertions.has(path[1]) ? undefined : 'strong';
    }
    const matcher = matcherOf(call);
    if (matcher === undefined) return undefined;
    const subject = call.arguments.map((arg) => arg.getText(sourceFile)).join(' ');
    if (mockOnly.test(matcher.name) || mockOnly.test(subject)) return 'mock';
    const weak = matcher.not
      ? matcher.name === 'toBeNull' || matcher.name === 'toBeUndefined'
      : matcher.name === 'toBeDefined' || matcher.name === 'toBeTruthy';
    return weak ? 'weak' : 'strong';
  }
  if (root.startsWith('expect')) return 'strong';
  if (root.startsWith('assert') || path.slice(1).includes('assert')) {
    const args = call.arguments.map((arg) => arg.getText(sourceFile)).join(' ');
    return mockOnly.test(args) ? 'mock' : 'strong';
  }
  if (path.length === 1 && helpers.has(root)) return 'strong';
  return undefined;
}

function assertionsIn(node: ts.Node, sourceFile: ts.SourceFile, helpers: Set<string>): Kind[] {
  const kinds: Kind[] = [];
  const visit = (child: ts.Node) => {
    if (ts.isCallExpression(child)) {
      const path = calleePath(child.expression, false);
      const kind = path && assertionKind(child, path, sourceFile, helpers);
      if (kind !== undefined) kinds.push(kind);
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return kinds;
}

// Functions declared in the file that assert, directly or through another such function.
function assertingHelpers(sourceFile: ts.SourceFile): Set<string> {
  const bodies = new Map<string, ts.Node>();
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      bodies.set(node.name.text, node.body);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isFunction(node.initializer)
    ) {
      bodies.set(node.name.text, node.initializer.body);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const helpers = new Set<string>();
  for (let grew = true; grew; ) {
    grew = false;
    for (const [name, body] of bodies) {
      if (!helpers.has(name) && assertionsIn(body, sourceFile, helpers).length > 0) {
        helpers.add(name);
        grew = true;
      }
    }
  }
  return helpers;
}

export function checkTestSource(fileName: string, text: string): Finding[] {
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const helpers = assertingHelpers(sourceFile);
  const lines = text.split('\n');
  const findings: Finding[] = [];
  const report = (node: ts.Node, message: string) => {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
    if (allow.test(lines[line] ?? '') || allow.test(lines[line - 1] ?? '')) return;
    findings.push({ line: line + 1, message });
  };

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const path = calleePath(node.expression, true);
      if (path?.[0] !== undefined && runners.has(path[0])) checkCall(node, path);
    }
    ts.forEachChild(node, visit);
  };

  const checkCall = (call: ts.CallExpression, path: string[]) => {
    const args = [...call.arguments];
    const options = args.find(ts.isObjectLiteralExpression);
    const option = (name: string) =>
      options?.properties.find(
        (p): p is ts.PropertyAssignment =>
          ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === name
      );
    if (path.includes('only') || option('only')?.initializer.kind === ts.SyntaxKind.TrueKeyword) {
      report(call, 'focused test (.only) runs only this test');
    }
    const [first] = args;
    const body = args.at(-1);
    const defines = first !== undefined && !isFunction(first) && body && isFunction(body);
    const skipped = path.includes('skip') || path.includes('fixme');
    if (skipped && path.at(-1) !== 'skipIf') {
      // `test.skip()` with no condition, or a whole test or suite switched off.
      if (args.length === 0 || defines) report(call, 'skipped without a reason or condition');
    }
    if (option('skip')?.initializer.kind === ts.SyntaxKind.TrueKeyword) {
      report(call, 'skipped without a reason (skip: true)');
    }
    const isTest =
      defines &&
      (path[0] === 'test' || path[0] === 'it') &&
      path.slice(1).every((part) => testModifiers.has(part));
    if (!isTest || skipped) return;
    const kinds = assertionsIn(body, sourceFile, helpers);
    if (kinds.length === 0) report(call, 'test has no assertion');
    else if (kinds.every((kind) => kind === 'mock')) {
      report(call, 'test asserts only that a mock was called');
    } else if (kinds.every((kind) => kind !== 'strong')) {
      report(call, 'test asserts only toBeDefined/toBeTruthy/not.toBeNull or mock calls');
    }
  };

  visit(sourceFile);
  return findings;
}

export function checkTests(root: string): string[] {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter((file) => testFile.test(file));
  return files.flatMap((file) =>
    checkTestSource(file, readFileSync(join(root, file), 'utf8')).map(
      (finding) => `${file}:${finding.line}: ${finding.message}`
    )
  );
}

if (import.meta.main) {
  const findings = checkTests(process.argv[2] ?? join(import.meta.dirname, '..'));
  for (const finding of findings) console.error(finding);
  if (findings.length > 0) {
    console.error(`\n${findings.length} test finding(s). See docs/adr/0039-quality-checks.md.`);
    process.exit(1);
  }
  console.log('tests: ok');
}
