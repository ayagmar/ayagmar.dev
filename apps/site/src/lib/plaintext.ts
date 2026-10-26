import type { ProjectSlug } from '@min7/contracts';
import { feedPaths } from './feed.ts';
import { postCount, postsAbout, projectPath } from './projects.ts';
import { nav, site, siteUrl } from './site.ts';
import { type Note, notePath } from './til.ts';
import { isoDay, type Post, postPath } from './writing.ts';

const width = 72;

/**
 * The home page room (ADR 0026) in ASCII, left to right as on the scene: corkboard and framed
 * screen, the window with the lamp in front, the monitor, the tea glass, the shelf and the
 * record player. ADR 0027.
 */
const asciiRoom = String.raw`
  .--------.     .-'"""'-.     *  *  *  *  *  *  *   .-------------.
  | -- - - |   .'  *    (  '.                        | ||| |||| || |
  | - -- - |  /     *   _    \     .--------------.  |-------------|
  '--------'  |  *    _/ \    |    | $ curl       |  | |||| || ||| |
  .--------.  |   _  |   |  _ |    |   ayagmar.dev|  |-------------|
  | #.##.# |  |__| |_|   |_| ||    | _            |  | || ||| |||| |
  | .#.#.# |  |==============|     '------..------'  |-------------|
  '--------'      __                ____||____  c[_] .-----------.
 ____________ ___/__\_____________ [__________] ____ | (@)  ==   |___
|____________________________________________________|___________|___|
`.slice(1, -1);

/** The page `curl ayagmar.dev` prints: who, recent writing and notes, projects, where to go next. */
export function renderPlainText(
  posts: readonly Post[],
  notes: readonly Note[],
  projects: readonly ProjectSlug[]
): string {
  const rule = '-'.repeat(width);
  const writing =
    posts.length === 0
      ? ['  Nothing published yet.']
      : posts
          .slice(0, 10)
          .flatMap((post) => [
            `  ${isoDay(post.data.date)}  ${post.data.title}`,
            `              ${siteUrl}${postPath(post.id)}`,
          ]);
  const til =
    notes.length === 0
      ? ['  Nothing published yet.']
      : notes
          .slice(0, 5)
          .flatMap((note) => [
            `  ${isoDay(note.data.date)}  ${note.data.title}`,
            `              ${siteUrl}${notePath(note.id)}`,
          ]);
  const slugWidth = Math.max(0, ...projects.map((slug) => slug.length)) + 2;
  const projectLines = projects.map(
    (slug) =>
      `  ${slug.padEnd(slugWidth)}${postCount(postsAbout(posts, slug).length).padEnd(10)}${siteUrl}${projectPath(slug)}`
  );
  return [
    asciiRoom,
    '',
    `${site.name} | ${site.author}`,
    `${site.role} in ${site.location}`,
    rule,
    'Writing',
    ...writing,
    rule,
    'TIL',
    ...til,
    rule,
    'Projects',
    ...projectLines,
    rule,
    ...nav.map((item) => `  ${item.label.padEnd(10)} ${siteUrl}${item.href}`),
    `  ${'RSS'.padEnd(10)} ${siteUrl}${feedPaths().rss}`,
    `  ${'Atom'.padEnd(10)} ${siteUrl}${feedPaths().atom}`,
    `  ${'GitHub'.padEnd(10)} ${site.links.github}`,
    '',
  ].join('\n');
}
