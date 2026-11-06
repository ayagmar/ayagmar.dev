import type { ProjectSlug } from '@min7/contracts';
import type { About } from '../data/about.ts';
import { aboutLinks, formatMonth, monthSpan } from '../data/about.ts';
import { projectFacts } from '../data/format.ts';
import type { Uses } from '../data/uses.ts';
import { absoluteLinks, articleMeta, noteArticle, textBody } from './article.ts';
import { feedPaths } from './feed.ts';
import {
  postCount,
  postsAbout,
  projectLinks,
  projectPath,
  projectRowLabel,
  type SiteProject,
} from './projects.ts';
import { curlTarget, identityLines, nav, nowPage, site, siteUrl } from './site.ts';
import { type Note, notePath } from './til.ts';
import { isoDay, nothingPublished, type Post, postPath, postsByTag } from './writing.ts';

const rule = '-'.repeat(72);

/** A built `.txt` page. Every text page ends in one newline. */
export const textFile = (body: string) =>
  new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

const empty = `  ${nothingPublished}`;

/** Lines of `date  title`, then the URL under it, then `extra` lines, for a list of entries. */
const dated = (date: Date, title: string, path: string, ...extra: string[]) => [
  `  ${isoDay(date)}  ${title}`,
  ...[`${siteUrl}${path}`, ...extra].map((line) => `              ${line}`),
];

/** A page's closing lines, with its HTML address. */
const footer = (path: string) => [
  rule,
  `  ${'Page'.padEnd(10)} ${siteUrl}${path}`,
  `  ${'Home'.padEnd(10)} ${siteUrl}`,
  '',
];

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

/**
 * The page `curl ayagmar.dev` prints: who, recent writing and notes, projects, where to go next.
 * `origin` is where this build is served, so a Preview's room command reaches its own room.
 */
export function renderPlainText(
  posts: readonly Post[],
  notes: readonly Note[],
  projects: readonly ProjectSlug[],
  origin: string
): string {
  const writing = posts
    .slice(0, 10)
    .flatMap((post) => dated(post.data.date, post.data.title, postPath(post.id)));
  const til = notes
    .slice(0, 5)
    .flatMap((note) => dated(note.data.date, note.data.title, notePath(note.id)));
  const slugWidth = Math.max(0, ...projects.map((slug) => slug.length)) + 2;
  const projectLines = projects.map(
    (slug) =>
      `  ${slug.padEnd(slugWidth)}${postCount(postsAbout(posts, slug).length).padEnd(10)}${siteUrl}${projectPath(slug)}`
  );
  return [
    asciiRoom,
    '',
    ...identityLines,
    // As on the home page, a section appears once it has something in it.
    ...(writing.length === 0 ? [] : [rule, 'Writing', ...writing]),
    ...(til.length === 0 ? [] : [rule, 'TIL', ...til]),
    rule,
    'Projects',
    ...projectLines,
    rule,
    ...[...nav, nowPage].map((item) => `  ${item.label.padEnd(10)} ${siteUrl}${item.href}`),
    `  ${'RSS'.padEnd(10)} ${siteUrl}${feedPaths().rss}`,
    `  ${'Atom'.padEnd(10)} ${siteUrl}${feedPaths().atom}`,
    `  ${'GitHub'.padEnd(10)} ${site.links.github}`,
    `  ${'In colour'.padEnd(10)} curl ${curlTarget(origin)}/room`,
    '',
  ].join('\n');
}

/** /writing: every post with its summary, then the tags. */
export function renderWritingText(posts: readonly Post[]): string {
  const tags = [...postsByTag(posts).keys()];
  return [
    `Writing | ${site.name}`,
    rule,
    ...(posts.length === 0
      ? [empty]
      : posts.flatMap((post) =>
          dated(
            post.data.date,
            `${post.data.title}${post.data.draft ? ' (draft)' : ''}`,
            postPath(post.id),
            post.data.summary
          )
        )),
    ...(tags.length === 0 ? [] : [rule, `Tags: ${tags.join(', ')}`]),
    ...footer('/writing'),
  ].join('\n');
}

/** /til: every note in full, as the page shows them. */
export function renderTilText(notes: readonly Note[]): string {
  const articles = notes.map(noteArticle);
  return [
    `Today I learned | ${site.name}`,
    rule,
    ...(articles.length === 0
      ? [empty]
      : articles.flatMap((article, index) => [
          ...(index === 0 ? [] : [rule]),
          article.title,
          ...articleMeta(article),
          `${siteUrl}${article.path}`,
          '',
          textBody(article),
        ])),
    ...footer('/til'),
  ].join('\n');
}

/** /projects: what each project is, its posts and its status. */
export function renderProjectsText(
  projects: readonly SiteProject[],
  posts: readonly Post[]
): string {
  return [
    `Projects | ${site.name}`,
    rule,
    ...projects.flatMap((project) => [
      project.slug,
      ...(project.summary === null ? [] : [`  ${project.summary}`]),
      ...(projectRowLabel(project, posts) === '' ? [] : [`  ${projectRowLabel(project, posts)}`]),
      `  ${siteUrl}${projectPath(project.slug)}`,
      '',
    ]),
    ...footer('/projects').slice(1),
  ].join('\n');
}

/**
 * /projects/<slug>: the summary, the description as written, the numbers from the build's
 * snapshot, the links and the posts. `description` is the project file's Markdown, if it has one.
 */
export function renderProjectText(
  project: SiteProject,
  posts: readonly Post[],
  description: string | undefined
): string {
  const path = projectPath(project.slug);
  const facts = projectFacts(project);
  return [
    `${project.slug} | ${site.name}`,
    ...(project.summary === null ? [] : [project.summary]),
    ...(project.status === null ? [] : [`Status: ${project.status}`]),
    rule,
    ...(description === undefined ? [] : [absoluteLinks(description, path).trim(), rule]),
    'Numbers',
    ...(facts.length === 0
      ? [`  No live numbers for ${project.slug} right now.`]
      : facts.map(({ label, value }) => `  ${label}: ${value}`)),
    rule,
    'Links',
    ...projectLinks(project).map(({ label, href }) => `  ${label}: ${href}`),
    rule,
    `Writing about ${project.slug}`,
    ...(posts.length === 0
      ? [`  Nothing written about ${project.slug} yet.`]
      : posts.flatMap((post) => dated(post.data.date, post.data.title, postPath(post.id)))),
    ...footer(path),
  ].join('\n');
}

/** /about: the CV the page shows, from the same file. */
export function renderAboutText(about: About): string {
  const { identity } = about;
  const span = (start: string, end: string | null) => {
    const dates = monthSpan(start, end);
    return `${dates.start} to ${dates.end}`;
  };
  return [
    `${identity.name} | ${site.name}`,
    about.summary,
    about.nameNote,
    rule,
    'Experience',
    ...about.experience.flatMap((role) => [
      `  ${role.role}, ${role.company}`,
      `    ${role.place}, ${span(role.start, role.end)}`,
      ...role.outcomes.map((outcome) => `    - ${outcome}`),
    ]),
    rule,
    'Certifications',
    ...about.certifications.flatMap((cert) => [
      `  ${cert.name}`,
      `    ${[
        `${cert.issuer}, issued ${formatMonth(cert.issued)}`,
        ...(cert.expires === undefined ? [] : [`expires ${formatMonth(cert.expires)}`]),
      ].join(
        ', '
      )}${cert.credentialId === undefined ? '' : `. Credential ID ${cert.credentialId}`}.`,
      `    ${cert.verifyUrl}`,
    ]),
    rule,
    'Education',
    ...about.education.flatMap((school) => [
      `  ${school.school}`,
      `    ${[school.degree, ...(school.field === undefined ? [] : [school.field])].join(', ')}, ${span(school.start, school.end)}`,
    ]),
    rule,
    'Skills',
    `  ${about.skills.join(', ')}`,
    rule,
    'Elsewhere',
    ...aboutLinks(identity).map(
      ({ href, label }) => `  ${label.padEnd(10)} ${href.startsWith('/') ? siteUrl + href : href}`
    ),
    ...footer('/about'),
  ].join('\n');
}

/** /uses: the hand-kept part. The live facts need the reader's browser (ADR 0032). */
export function renderUsesText(uses: Uses): string {
  return [
    `Uses | ${site.name}`,
    uses.intro,
    rule,
    ...uses.sections.flatMap((section) => [
      section.title,
      ...section.items.map((item) =>
        item.detail === undefined ? `  ${item.name}` : `  ${item.name}: ${item.detail}`
      ),
      rule,
    ]),
    ...uses.machines.flatMap((machine) => [
      machine.name,
      ...(machine.model === undefined ? [] : [`  ${machine.model}`]),
      ...machine.specs.map((spec) => `  ${spec.part}: ${spec.value}`),
      rule,
    ]),
    ...footer('/uses').slice(1),
  ].join('\n');
}
