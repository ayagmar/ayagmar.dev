// Fails on comments that narrate the code or its history instead of saying why (ADR 0039), in
// the source under apps/, packages/, producers/ and scripts/. The phrases are few on purpose: a
// false positive costs more than a miss. A marker for later work needs an issue number or URL.
// Usage: node scripts/check-comments.ts [repo-root]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

export interface Finding {
  line: number;
  message: string;
}

// A phrase at the start of a sentence: "Note that x" is filler, "a note that ships" is not.
const opening = (phrase: string) => new RegExp(`(?<=^\\s*|[.;:!?]\\s+)${phrase}`, 'i');
const phrases: readonly [RegExp, string][] = [
  [/\bnow we\b/i, 'narrates steps ("now we")'],
  [/\bfirst,? we\b/i, 'narrates steps ("first we")'],
  [opening('next,'), 'narrates steps ("next,")'],
  [/\bhere we\b/i, 'narrates steps ("here we")'],
  [opening('this function\\b'), 'restates the code ("this function")'],
  [/\bpreviously\b/i, 'describes history ("previously")'],
  // The habitual past only; the passive ("is used to build") passes.
  [
    /(?<!\b(?:is|are|be|been|being|was|were|gets?|got)\s+)\bused to\b/i,
    'describes history ("used to")',
  ],
  [opening('new:'), 'describes history ("new:")'],
  [/\bupdated to\b/i, 'describes history ("updated to")'],
  [/\bsimply\b/i, 'filler ("simply")'],
  [/\bbasically\b/i, 'filler ("basically")'],
  [opening('note that\\b'), 'filler ("note that")'],
];
const todo = /\b(?:TODO|FIXME)\b/;
const issue = /#\d+|https?:\/\//;
const scripted = /\.(?:[cm]?[jt]sx?)$/;
const source = /^(?:apps|packages|producers|scripts)\/.*\.(?:[cm]?[jt]sx?|astro|svelte|css)$/;

interface Comment {
  pos: number;
  text: string;
}

// Every comment the TypeScript parser sees, tokens included, so a comment before a closing brace
// counts and one inside a string or regex does not.
function scriptComments(text: string, offset: number): Comment[] {
  const sourceFile = ts.createSourceFile('x.ts', text, ts.ScriptTarget.Latest, true);
  const seen = new Map<number, Comment>();
  const visit = (node: ts.Node) => {
    const ranges = [
      ...(ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []),
      ...(ts.getTrailingCommentRanges(text, node.end) ?? []),
    ];
    for (const range of ranges) {
      seen.set(range.pos, { pos: offset + range.pos, text: text.slice(range.pos, range.end) });
    }
    for (const child of node.getChildren(sourceFile)) visit(child);
  };
  visit(sourceFile);
  return [...seen.values()];
}

const blockComments = (text: string, pattern: RegExp, offset = 0): Comment[] =>
  [...text.matchAll(pattern)].map((match) => ({ pos: offset + match.index, text: match[0] }));

// .astro and .svelte: the frontmatter and scripts as TypeScript, styles as CSS, the markup's
// HTML comments.
function componentComments(text: string): Comment[] {
  const comments: Comment[] = [];
  const frontmatter = /^(\s*---\r?\n)([\s\S]*?)\r?\n---/.exec(text);
  if (frontmatter) {
    comments.push(...scriptComments(frontmatter[2] ?? '', frontmatter[1]?.length ?? 0));
  }
  for (const match of text.matchAll(/(<script\b[^>]*>)([\s\S]*?)<\/script>/g)) {
    comments.push(...scriptComments(match[2] ?? '', match.index + (match[1]?.length ?? 0)));
  }
  for (const match of text.matchAll(/(<style\b[^>]*>)([\s\S]*?)<\/style>/g)) {
    const offset = match.index + (match[1]?.length ?? 0);
    comments.push(...blockComments(match[2] ?? '', /\/\*[\s\S]*?\*\//g, offset));
  }
  const markup = text.replace(/<(script|style)\b[\s\S]*?<\/\1>/g, (block) =>
    ' '.repeat(block.length)
  );
  comments.push(...blockComments(markup, /<!--[\s\S]*?-->/g));
  return comments;
}

export function checkCommentSource(fileName: string, text: string): Finding[] {
  const comments = scripted.test(fileName)
    ? scriptComments(text, 0)
    : fileName.endsWith('.css')
      ? blockComments(text, /\/\*[\s\S]*?\*\//g)
      : componentComments(text);
  const lineOf = (pos: number) => text.slice(0, pos).split('\n').length;
  const findings: Finding[] = [];
  for (const comment of comments) {
    // Comment markers as spaces, so a sentence's start is the comment's and positions hold.
    const words = comment.text
      .replace(/^(\s*)(?:\/\/+|\/\*+|\*+(?!\/)|<!--)/gm, (marker) => ' '.repeat(marker.length))
      .replace(/\*\/|-->/g, (marker) => ' '.repeat(marker.length));
    for (const [phrase, message] of phrases) {
      const match = phrase.exec(words);
      if (match) {
        findings.push({ line: lineOf(comment.pos + match.index), message });
      }
    }
    const marker = todo.exec(words);
    if (marker && !issue.test(words)) {
      findings.push({
        line: lineOf(comment.pos + marker.index),
        message: `${marker[0]} without an issue number or URL`,
      });
    }
  }
  return findings.sort((a, b) => a.line - b.line);
}

export function checkComments(root: string): string[] {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter((file) => source.test(file));
  return files.flatMap((file) =>
    checkCommentSource(file, readFileSync(join(root, file), 'utf8')).map(
      (finding) => `${file}:${finding.line}: ${finding.message}`
    )
  );
}

if (import.meta.main) {
  const findings = checkComments(process.argv[2] ?? join(import.meta.dirname, '..'));
  for (const finding of findings) console.error(finding);
  if (findings.length > 0) {
    console.error(`\n${findings.length} comment finding(s). See docs/adr/0039-quality-checks.md.`);
    process.exit(1);
  }
  console.log('comments: ok');
}
