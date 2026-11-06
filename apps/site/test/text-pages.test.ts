import type { ProjectsSnapshot } from '@min7/contracts';
import { fixturesCapturedAt, snapshotFixtures } from '@min7/contracts/fixtures';
import { type MdastNode, markdownToMdast } from 'satteri';
import { describe, expect, it } from 'vitest';
import {
  absoluteLinks,
  noteArticle,
  postArticle,
  renderArticleMarkdown,
  renderArticleText,
} from '../src/lib/article.ts';
import { renderLlmsTxt } from '../src/lib/llms.ts';
import {
  renderPlainText,
  renderProjectText,
  renderTilText,
  renderWritingText,
} from '../src/lib/plaintext.ts';
import { projectRowLabel, type SiteProject, siteProjects } from '../src/lib/projects.ts';
import { renderStatsText, type StatsSources } from '../src/lib/stats-text.ts';
import type { Note } from '../src/lib/til.ts';
import type { Post } from '../src/lib/writing.ts';

const post = (id: string, data: Partial<Post['data']> = {}, body = 'Body.'): Post => ({
  id,
  body,
  data: {
    title: 'A post',
    date: new Date('2026-10-24'),
    summary: 'What it says.',
    tags: [],
    draft: false,
    projects: [],
    ...data,
  },
});

const note = (id: string, body: string): Note => ({
  id,
  body,
  data: { title: 'A note', date: new Date('2026-10-25'), tags: [], draft: false },
});

/** The link destinations of `markdown` as a parser reads them, and its text outside them. */
function parsed(markdown: string) {
  const destinations: string[] = [];
  const read = (node: MdastNode): string => {
    if ('url' in node) destinations.push(node.url);
    if ('children' in node) return node.children.map((child) => read(child as MdastNode)).join('');
    return node.type === 'text' || node.type === 'inlineCode' ? node.value : '';
  };
  const text = read(markdownToMdast(markdown));
  return { destinations, text };
}

describe('links in a copy', () => {
  // Catches a relative link in a post that points nowhere once the text is read in a terminal.
  it('makes link, image and definition targets absolute', () => {
    const body = '[a](/til/x "T") ![i](./p.png) [r][d] [e](https://e.example/y)\n\n[d]: ../z\n';
    expect(absoluteLinks(body, '/writing/post')).toBe(
      '[a](https://ayagmar.dev/til/x "T") ![i](https://ayagmar.dev/writing/p.png) [r][d] [e](https://e.example/y)\n\n[d]: https://ayagmar.dev/z\n'
    );
  });

  // Catches a rewrite that edits code samples, whose text must stay as the author wrote it.
  it('leaves links shown in code alone', () => {
    const body = '`[a](/x)`\n\n```md\n[b](/y)\n```\n';
    expect(absoluteLinks(body, '/writing/post')).toBe(body);
  });

  // Catches the target being found in the link's text instead of after it.
  it('rewrites the target when the link text repeats it', () => {
    expect(absoluteLinks('[/x](/x)', '/writing/post')).toBe('[/x](https://ayagmar.dev/x)');
  });

  // Catches the destination being found by its text: a title that repeats it was rewritten and
  // the link left relative.
  it('rewrites the destination, not a title that repeats it', () => {
    expect(absoluteLinks('[a](/about "Read /about")', '/writing/post')).toBe(
      '[a](https://ayagmar.dev/about "Read /about")'
    );
    expect(absoluteLinks('[d]: /about "Read /about"\n\n[d]', '/writing/post')).toBe(
      '[d]: https://ayagmar.dev/about "Read /about"\n\n[d]'
    );
  });

  // Catches an edit past the end of the link, in the prose after it.
  it('leaves prose that repeats the destination alone', () => {
    expect(absoluteLinks('[a](/x)/x', '/writing/post')).toBe('[a](https://ayagmar.dev/x)/x');
  });

  // Catches syntax a plain search or a naive scan reads wrongly, and a target written back so it
  // no longer parses as the same link: brackets and code in a label, parentheses, escapes and
  // angle brackets in a destination, an image inside a link. Read back through the parser,
  // since the text of a broken link can look right.
  it('keeps every form of destination a link to the same place', () => {
    const site = 'https://ayagmar.dev';
    const cases: [body: string, destinations: string[], text: string][] = [
      ['[a [b] `]`](/x)', [`${site}/x`], 'a [b] ]'],
      ['[a](/x_(y) "t")', [`${site}/x_(y)`], 'a'],
      ['[a](</x y>)', [`${site}/x%20y`], 'a'],
      ['[a](</x(y>)', [`${site}/x(y`], 'a'],
      ['[a](/x\\(y)', [`${site}/x(y`], 'a'],
      ['[a](/x\\)y) after', [`${site}/x)y`], 'a after'],
      ['[a](#x\\)y)', [`${site}/writing/post#x)y`], 'a'],
      ['[d]\n\n[d]: /x\\)y', [`${site}/x)y`], 'd'],
      ['[![i](/i.png)](/b)', [`${site}/b`, `${site}/i.png`], ''],
      ['[a](https://e.example)', ['https://e.example'], 'a'],
      ['<https://e.example>', ['https://e.example'], 'https://e.example'],
      ['[a](mailto:hello@ayagmar.dev)', ['mailto:hello@ayagmar.dev'], 'a'],
    ];
    for (const [body, destinations, text] of cases) {
      expect(parsed(absoluteLinks(body, '/writing/post')), body).toEqual({ destinations, text });
    }
  });

  // Catches `<...>` wrapped a second time, which makes the brackets part of the destination.
  it('writes an angle-bracket destination back once', () => {
    expect(absoluteLinks('[a](</x y>)', '/writing/post')).toBe('[a](<https://ayagmar.dev/x%20y>)');
  });

  // Catches a section link that lands on nothing: a note's ids carry its name (ADR 0028).
  it('sends a fragment to the page with the ids it uses', () => {
    expect(noteArticle(note('first', '[s](#setup)')).idPrefix).toBe('first-');
    expect(absoluteLinks('[s](#setup)', '/til/first', 'first-')).toBe(
      '[s](https://ayagmar.dev/til/first#first-setup)'
    );
    expect(absoluteLinks('[s](#setup)', '/writing/post')).toBe(
      '[s](https://ayagmar.dev/writing/post#setup)'
    );
  });
});

const diagram = `Before.

\`\`\`mermaid
flowchart TB
  accTitle: The flow
  accDescr: A goes to B.
  a --> b
\`\`\`

\`\`\`mermaid title="Named by its fence"
pie
  "a" : 1
\`\`\`
`;

describe('a post as Markdown and text', () => {
  // Catches a title with a colon or quote breaking the frontmatter a reader parses.
  it('keeps any title and summary valid in the frontmatter', () => {
    const markdown = renderArticleMarkdown(
      postArticle(post('p', { title: 'Cache: the "real" cost', summary: 'Say: yes' }))
    );
    expect(markdown).toBe(`---
title: "Cache: the \\"real\\" cost"
author: "Abdeslam Yassine Agmar"
date: 2026-10-24
summary: "Say: yes"
canonical: https://ayagmar.dev/writing/p
---

# Cache: the "real" cost

Body.
`);
  });

  // Catches a Preview's draft reading as published, and tags or a later edit going missing.
  it('carries the draft flag, the tags and the updated day', () => {
    const data = { draft: true, tags: ['a', 'b'], updated: new Date('2026-10-30') };
    const article = postArticle(post('p', data));
    expect(renderArticleMarkdown(article)).toContain(
      'updated: 2026-10-30\nsummary: "What it says."\ntags: ["a","b"]\ndraft: true\n'
    );
    expect(renderArticleText(article)).toContain(
      'Draft, 2026-10-24, updated 2026-10-30\nTags: a, b\n'
    );
  });

  // Catches an agent losing the diagram: the fence is the only form of it a `.md` can carry.
  it('keeps Mermaid fences in Markdown', () => {
    expect(renderArticleMarkdown(postArticle(post('p', {}, diagram)))).toContain(diagram.trim());
  });

  // Catches Mermaid source printed to a terminal, or a diagram dropped without saying so.
  it('names each diagram in text and links the page that draws it', () => {
    const text = renderArticleText(postArticle(post('p', {}, diagram)));
    expect(text).toContain(`Before.

[Diagram: The flow]
A goes to B.
https://ayagmar.dev/writing/p

[Diagram: Named by its fence]
https://ayagmar.dev/writing/p
`);
    expect(text).not.toContain('flowchart');
  });
});

describe('list pages', () => {
  // Catches an empty site printing a blank page instead of saying so.
  it('say when nothing is published', () => {
    expect(renderWritingText([])).toContain(
      'Writing | min7\n'.concat('-'.repeat(72), '\n  Nothing published yet.\n')
    );
    expect(renderTilText([])).toContain('  Nothing published yet.\n');
  });

  // Catches a project's row printing a zero count: on /projects and in its text copy a row says
  // only what the project has, and picks the count up again with the first post.
  it('leave out a post count of zero', () => {
    const project = { ...siteProjects([], null)[0], status: 'active' } as SiteProject;
    expect(projectRowLabel(project, [])).toBe('active');
    expect(projectRowLabel({ ...project, status: null }, [])).toBe('');
    const about = post('p', { projects: [project.slug] });
    expect(projectRowLabel(project, [about])).toBe('1 post, active');
  });

  // Catches the text copy of home keeping an empty band, or staying empty once there are posts.
  it('leave a section out of index.txt until it has content', () => {
    const empty = renderPlainText([], [], []);
    expect(empty).not.toMatch(/^(Writing|TIL)$/m);
    expect(empty).not.toContain('Nothing published');
    const full = renderPlainText([post('p')], [note('n', 'Body.')], []);
    expect(full).toMatch(/^Writing\n {2}2026-10-24 {2}A post$/m);
    expect(full).toMatch(/^TIL\n {2}2026-10-25 {2}A note$/m);
  });

  // Catches a Preview listing a draft as if it were published.
  it('mark a draft post', () => {
    expect(renderWritingText([post('p', { draft: true })])).toContain(
      '  2026-10-24  A post (draft)\n              https://ayagmar.dev/writing/p\n              What it says.\n'
    );
  });

  // Catches /til showing only titles, when the page shows every note whole.
  it('show each note in full', () => {
    const text = renderTilText([note('one', 'First [body](/x).'), note('two', 'Second body.')]);
    expect(text).toContain('First [body](https://ayagmar.dev/x).');
    expect(text).toContain('Second body.');
    expect(text).toContain('2026-10-25\nhttps://ayagmar.dev/til/two\n');
  });

  // Catches a Preview's draft note reading as published on /til, which marks it (TilNote.astro).
  it('mark a draft note and give its tags, as the page does', () => {
    const draft = note('one', 'Body.');
    draft.data = { ...draft.data, draft: true, tags: ['bash', 'niri'] };
    expect(renderTilText([draft])).toContain(
      'A note\nDraft, 2026-10-25\nTags: bash, niri\nhttps://ayagmar.dev/til/one\n'
    );
  });
});

describe('a project page', () => {
  const [project] = siteProjects([], null);
  if (project === undefined) throw new Error('no featured projects');

  // Catches a build without the projects snapshot failing or printing empty numbers.
  it('says so when the snapshot has no numbers', () => {
    expect(renderProjectText(project, [], undefined)).toContain(
      `Numbers\n  No live numbers for ${project.slug} right now.\n`
    );
  });

  // Catches the text losing what the page shows from the snapshot and the project file.
  it('gives the numbers, the links and the description', () => {
    const [live] = siteProjects(
      [],
      (snapshotFixtures.projects.ok as ProjectsSnapshot).projects
    ).filter((candidate) => candidate.live?.stars != null);
    if (live === undefined) throw new Error('no fixture project with stars');
    const text = renderProjectText(live, [post('p')], 'See [docs](/about).');
    expect(text).toContain(`  Stars: ${live.live?.stars?.toLocaleString('en')}\n`);
    expect(text).toContain(`  ${live.repo} on GitHub: ${live.repoUrl}\n`);
    expect(text).toContain('See [docs](https://ayagmar.dev/about).');
    expect(text).toContain('  2026-10-24  A post\n');
  });
});

const envelope = (source: string, data: unknown, stale = false) => ({
  source,
  version: 1,
  fetchedAt: data === null ? null : fixturesCapturedAt,
  stale,
  data,
});

const sources = (stale = false) =>
  ({
    listening: envelope('listening', snapshotFixtures.listening.ok, stale),
    projects: envelope('projects', snapshotFixtures.projects.ok, stale),
    typing: envelope('monkeytype', snapshotFixtures.monkeytype.ok, stale),
    shipping: envelope('shipping', snapshotFixtures.shipping.ok, stale),
    llmUsage: envelope('llm-usage', snapshotFixtures['llm-usage'].ok, stale),
  }) as unknown as StatsSources;

describe('/stats as text', () => {
  // Catches fixture numbers in a Preview's text passing as the real thing.
  it('says sample data is sample data', () => {
    const text = renderStatsText(sources(), true);
    expect(text).toContain('Stats | min7\nSample data: this build shows the test fixtures');
    expect(text).toContain('Sample data, not live\n');
    expect(text).not.toContain('Updated ');
  });

  // Catches a snapshot that reads as current: this text is only as new as the last build.
  it('dates every panel, and says when a source was stale', () => {
    expect(
      renderStatsText(sources(), false).match(/Updated 26 Oct, 09:00 \(Rabat time\)/g)
    ).toHaveLength(5);
    expect(renderStatsText(sources(true), false)).toContain(
      'May be out of date: updated 26 Oct, 09:00 (Rabat time)\n'
    );
  });

  // Catches a build with signals down failing, or a panel left blank.
  it('says what is missing when a source has no data', () => {
    const empty = {
      listening: envelope('listening', null),
      projects: envelope('projects', null),
      typing: envelope('monkeytype', null),
      shipping: envelope('shipping', null),
      llmUsage: envelope('llm-usage', null),
    } as unknown as StatsSources;
    const text = renderStatsText(empty, false);
    for (const line of [
      'Listening\nNo listening data yet\n',
      'Projects\nNo project data yet.\n',
      'Typing\nNo typing data yet.\n',
      'Shipping\nNo public activity to show yet.\n',
      'LLM usage\nNo data yet.\n',
    ]) {
      expect(text).toContain(line);
    }
  });

  // Catches folded lists losing their rest, columns running together, and chart cells or the
  // fold's own label reaching the text.
  it('writes the panels out as lines', () => {
    const text = renderStatsText(sources(), true);
    expect(text).toContain('  1. pi-mobile  115 stars\n');
    expect(text).toContain('  1. Claude Code  39.8M  65%\n');
    expect(text).toContain('Tokens  61.3M  16.4M\n');
    expect(text).toContain('  60 seconds: 104 wpm 92% accuracy 14 Jan 2021\n');
    expect(text.match(/ (merged #|pushed |released |gained )/g)).toHaveLength(15);
    expect(text).not.toMatch(/earlier events|more repositories/);
  });

  // Catches the text publishing what the owner keeps off the page (ADR 0014).
  it('shows no cost', () => {
    expect(renderStatsText(sources(), true)).not.toMatch(/\$|cost|USD/i);
  });
});

describe('/llms.txt', () => {
  const origin = 'https://ayagmar.dev';

  // Catches a heading or a list item outside the format, which breaks llmstxt.org parsers:
  // H1, summary quote, details without headings, then H2 lists of `- [name](url): notes`.
  it('follows the llmstxt.org structure', () => {
    const text = renderLlmsTxt(
      [post('p', { title: 'A [bracketed] title', summary: 'Two\n  lines.' })],
      [note('n', 'A note.')],
      [{ slug: 'runnerd', summary: null }],
      origin
    );
    const [title, , summary, , details, , ...rest] = text.split('\n');
    expect(title).toBe('# min7');
    expect(summary).toMatch(/^> \S/);
    expect(details).not.toMatch(/^#/);
    for (const line of rest.filter((candidate) => candidate !== '')) {
      expect(line).toMatch(/^(## \S.*|- \[(\\.|[^\]\\])+\]\(https:\/\/\S+\)(: \S.*)?)$/);
    }
    expect(text).toContain(
      '- [A \\[bracketed\\] title](https://ayagmar.dev/writing/p.md): Two lines.\n'
    );
    expect(text).toContain('- [A note](https://ayagmar.dev/til/n.md): A note.\n');
    expect(text).toContain('- [runnerd](https://ayagmar.dev/projects/runnerd.txt)\n');
    expect(text.endsWith('.xml)\n')).toBe(true);
  });

  // Catches a heading over an empty list while nothing is published.
  it('leaves out a section with nothing in it', () => {
    const text = renderLlmsTxt([], [], [], origin);
    expect(text).not.toMatch(/## (Writing|TIL|Projects)/);
    expect(text).toContain('## Pages\n');
  });

  // Catches a Preview's file sending an agent to production, where its drafts do not exist.
  it('links where the build is served', () => {
    const text = renderLlmsTxt([post('p')], [], [], 'https://x-min7-site.ayagmar.workers.dev');
    expect(text).toContain('(https://x-min7-site.ayagmar.workers.dev/writing/p.md)');
    expect(text).not.toContain('https://ayagmar.dev');
  });
});
