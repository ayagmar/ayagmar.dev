import type { ProjectEvent, ProjectSlug } from '@min7/contracts';
import { isoDate } from '@min7/contracts/rabat';
import type { About } from '../data/about.ts';
import { aboutLinks, certificationExpiry, formatMonth, monthSpan } from '../data/about.ts';
import { describeEvent, projectFacts } from '../data/format.ts';
import type { Uses } from '../data/uses.ts';
import { absoluteLinks, articleMeta, noteArticle, textBody } from './article.ts';
import { longDate } from './day-words.ts';
import { feedPaths } from './feed.ts';
import type { BrewingItem } from './now-schema.ts';
import { noNumbers } from './project-panel.ts';
import {
  postCount,
  postsAbout,
  projectLinks,
  projectPath,
  projectRowLabel,
  projectsByGroup,
  type SiteProject,
} from './projects.ts';
import { curlTarget, identityLine, nav, nowPage, site, siteUrl, textRule } from './site.ts';
import { type Note, notePath } from './til.ts';
import { rabatStamp } from './words.ts';
import { isoDay, nothingPublished, type Post, postPath, postsByTag } from './writing.ts';

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
  textRule,
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
 * `summary` is the pitch the home page shows under the name, from content/about.json. `origin` is
 * where this build is served, so a Preview's room command reaches its own room.
 */
export function renderPlainText(
  summary: string,
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
    identityLine,
    summary,
    // As on the home page, a section appears once it has something in it.
    ...(writing.length === 0 ? [] : [textRule, 'Writing', ...writing]),
    ...(til.length === 0 ? [] : [textRule, 'TIL', ...til]),
    textRule,
    'Projects',
    ...projectLines,
    textRule,
    ...[...nav, nowPage].map((item) => `  ${item.label.padEnd(10)} ${siteUrl}${item.href}`),
    `  ${'RSS'.padEnd(10)} ${siteUrl}${feedPaths().rss}`,
    `  ${'Atom'.padEnd(10)} ${siteUrl}${feedPaths().atom}`,
    `  ${'Email'.padEnd(10)} ${site.email}`,
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
    textRule,
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
    ...(tags.length === 0 ? [] : [textRule, `Tags: ${tags.join(', ')}`]),
    ...footer('/writing'),
  ].join('\n');
}

/** /til: every note in full, as the page shows them. */
export function renderTilText(notes: readonly Note[]): string {
  const articles = notes.map(noteArticle);
  return [
    `Today I learned | ${site.name}`,
    textRule,
    ...(articles.length === 0
      ? [empty]
      : articles.flatMap((article, index) => [
          ...(index === 0 ? [] : [textRule]),
          article.title,
          ...articleMeta(article),
          `${siteUrl}${article.path}`,
          '',
          textBody(article),
        ])),
    ...footer('/til'),
  ].join('\n');
}

/** /projects: what each project is, its posts and its status, under the page's headings. */
export function renderProjectsText(
  projects: readonly SiteProject[],
  posts: readonly Post[]
): string {
  return [
    `Projects | ${site.name}`,
    textRule,
    ...projectsByGroup(projects).flatMap((group, index) => [
      ...(index === 0 ? [] : [textRule]),
      group.title,
      '',
      ...group.projects.flatMap((project) => [
        project.slug,
        ...(project.summary === null ? [] : [`  ${project.summary}`]),
        ...(projectRowLabel(project, posts) === '' ? [] : [`  ${projectRowLabel(project, posts)}`]),
        `  ${siteUrl}${projectPath(project.slug)}`,
        '',
      ]),
    ]),
    ...footer('/projects').slice(1),
  ].join('\n');
}

/**
 * /projects/<slug>: the summary, the description as written, the numbers from the build's
 * snapshot, its log, the links and the posts. `description` is the project file's Markdown, if
 * it has one; `shipped` is the project's log as its page draws it.
 */
export function renderProjectText(
  project: SiteProject,
  posts: readonly Post[],
  description: string | undefined,
  shipped: readonly ProjectEvent[]
): string {
  const path = projectPath(project.slug);
  const facts = projectFacts(project);
  return [
    `${project.slug} | ${site.name}`,
    ...(project.summary === null ? [] : [project.summary]),
    ...(project.status === null ? [] : [`Status: ${project.status}`]),
    textRule,
    ...(description === undefined ? [] : [absoluteLinks(description, path).trim(), textRule]),
    'Numbers',
    ...(facts.length === 0
      ? [`  ${noNumbers(project)}`]
      : facts.map(({ label, value }) => `  ${label}: ${value}`)),
    textRule,
    ...(shipped.length === 0
      ? []
      : [
          'Recently shipped',
          ...shipped.flatMap((event) => [
            `  ${rabatStamp(event.at).padEnd(13)}  ${describeEvent(event)}`,
            `                 ${event.url}`,
          ]),
          textRule,
        ]),
    'Links',
    ...projectLinks(project).map(({ label, href }) => `  ${label}: ${href}`),
    textRule,
    `Writing about ${project.slug}`,
    ...(posts.length === 0
      ? [`  Nothing written about ${project.slug} yet.`]
      : posts.flatMap((post) => dated(post.data.date, post.data.title, postPath(post.id)))),
    ...footer(path),
  ].join('\n');
}

/** /about: the CV the page shows, from the same file. */
export function renderAboutText(about: About, today: Date): string {
  const { identity } = about;
  const span = (start: string, end: string | null) => {
    const dates = monthSpan(start, end);
    return `${dates.start} to ${dates.end}`;
  };
  return [
    `${identity.name} | ${site.name}`,
    about.summary,
    about.nameNote,
    textRule,
    'Experience',
    ...about.experience.flatMap((role) => [
      `  ${role.role}, ${role.company}`,
      `    ${role.place}, ${span(role.start, role.end)}`,
      ...role.outcomes.map((outcome) => `    - ${outcome}`),
    ]),
    textRule,
    'Certifications',
    ...about.certifications.flatMap((cert) => [
      `  ${cert.name}`,
      `    ${[
        `${cert.issuer}, issued ${formatMonth(cert.issued)}`,
        ...(cert.expires === undefined ? [] : [certificationExpiry(cert.expires, today).text]),
        ...(cert.credentialId === undefined ? [] : [`Credential ID ${cert.credentialId}`]),
      ].join('. ')}.`,
      `    Verify: ${cert.verifyUrl}`,
    ]),
    textRule,
    'Education',
    ...about.education.flatMap((school) => [
      `  ${school.school}`,
      `    ${[school.degree, ...(school.field === undefined ? [] : [school.field])].join(', ')}, ${span(school.start, school.end)}`,
    ]),
    textRule,
    'Stack',
    `  ${about.stack.join(', ')}`,
    textRule,
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
    textRule,
    ...uses.sections.flatMap((section) => [
      section.title,
      ...section.items.flatMap((item) => [
        item.detail === undefined ? `  ${item.name}` : `  ${item.name}: ${item.detail}`,
        ...(item.url === undefined ? [] : [`    ${item.url}`]),
      ]),
      textRule,
    ]),
    ...uses.machines.flatMap((machine) => [
      machine.name,
      ...(machine.model === undefined ? [] : [`  ${machine.model}`]),
      ...machine.specs.map((spec) => `  ${spec.part}: ${spec.value}`),
      textRule,
    ]),
    ...footer('/uses').slice(1),
  ].join('\n');
}

/** `30 October 2026`: the day /now was last updated, as the page and its plain text say it. */
export const updatedOn = (updated: Date) => longDate(isoDate(updated.getTime()));

export const brewingTitle = 'Currently brewing';

/**
 * /now as plain text, what `curl ayagmar.dev/now` prints (worker/index.ts): the same frontmatter
 * and Markdown body the page renders, the body left as Markdown, which reads as text.
 */
export function renderNowText(
  { updated, brewing }: { updated: Date; brewing: readonly BrewingItem[] },
  body: string
): string {
  const items = brewing.flatMap((item) => [
    `  ${item.name}`,
    `    ${item.note}`,
    ...(item.url === undefined ? [] : [`    ${item.url}`]),
  ]);
  return [
    `${nowPage.label} | ${site.name}`,
    `Updated ${updatedOn(updated)}.`,
    textRule,
    ...(items.length === 0 ? [] : [brewingTitle, ...items, textRule]),
    body.trim(),
    textRule,
    `  ${'Home'.padEnd(10)} ${siteUrl}`,
    '',
  ].join('\n');
}
