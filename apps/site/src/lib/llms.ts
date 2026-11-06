/**
 * /llms.txt, in the format of https://llmstxt.org: the site's name, a one-line summary, then
 * lists of links to the Markdown and text copies (ADR 0040). The posts and notes are the entries
 * of the feeds, so the file and the feeds cannot disagree on what is published.
 */
import { buildFeed, buildTilFeed, feedPaths } from './feed.ts';
import { nowPage, site } from './site.ts';
import type { Note } from './til.ts';
import type { Post } from './writing.ts';

interface Item {
  name: string;
  path: string;
  note?: string | null;
}

// Link text ends at the first unescaped `]`, and a list item at the end of its line.
const linkText = (text: string) => text.replace(/[\\[\]]/g, '\\$&');
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/** `origin` is where this build is served, so a Preview's links reach its own drafts. */
export function renderLlmsTxt(
  posts: readonly Post[],
  notes: readonly Note[],
  projects: readonly { slug: string; summary: string | null }[],
  origin: string
): string {
  const copies = (entries: { url: string; title: string; summary: string }[]): Item[] =>
    entries.map(({ url, title, summary }) => ({
      name: title,
      path: `${new URL(url).pathname}.md`,
      note: summary,
    }));
  const section = (title: string, items: readonly Item[]) =>
    items.length === 0
      ? []
      : [
          `## ${title}`,
          '',
          ...items.map(({ name, path, note }) => {
            const link = `- [${linkText(oneLine(name))}](${new URL(path, origin).href})`;
            return note ? `${link}: ${oneLine(note)}` : link;
          }),
          '',
        ];
  return [
    `# ${site.name}`,
    '',
    `> ${site.description}`,
    '',
    'Posts and notes are Markdown at their page URL plus `.md`; other pages are plain text at their URL plus `.txt`. A page URL also answers `Accept: text/markdown` with its Markdown or text copy.',
    '',
    ...section('Writing', copies(buildFeed(posts).entries)),
    ...section('TIL', copies(buildTilFeed(notes).entries)),
    ...section(
      'Projects',
      projects.map(({ slug, summary }) => ({
        name: slug,
        path: `/projects/${slug}.txt`,
        note: summary,
      }))
    ),
    ...section('Pages', [
      {
        name: 'About',
        path: '/about.txt',
        note: `Who ${site.author} is: work, certifications, education.`,
      },
      { name: nowPage.label, path: '/now.txt', note: 'What is being worked on this month.' },
      { name: 'Uses', path: '/uses.txt', note: 'The tools and machines in daily use.' },
    ]),
    ...section('Optional', [
      {
        name: 'Home',
        path: '/index.txt',
        note: 'The latest writing and notes, with the projects.',
      },
      { name: 'Writing list', path: '/writing.txt' },
      { name: 'All TIL notes', path: '/til.txt' },
      { name: 'Project list', path: '/projects.txt' },
      {
        name: 'Stats',
        path: '/stats.txt',
        note: 'Listening, shipping, typing and LLM usage as of the last build.',
      },
      { name: 'RSS feed', path: feedPaths().rss },
      { name: 'Atom feed', path: feedPaths().atom },
    ]),
  ]
    .join('\n')
    .trimEnd()
    .concat('\n');
}
