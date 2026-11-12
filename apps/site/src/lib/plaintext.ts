import { featuredProjects, type ProjectEvent } from '@min7/contracts';
import { isoDate } from '@min7/contracts/rabat';
import type { About } from '../data/about.ts';
import {
  aboutLinks,
  certificationExpiry,
  contactLine,
  formatMonth,
  monthSpan,
} from '../data/about.ts';
import { describeEvent, projectFacts } from '../data/format.ts';
import type { Uses } from '../data/uses.ts';
import { absoluteLinks, articleMeta, noteArticle, textBody } from './article.ts';
import { longDate } from './day-words.ts';
import { feedPaths } from './feed.ts';
import { type NoctaliaPlugin, pluginsSection, pluginUrl } from './noctalia-plugins.ts';
import type { BrewingItem } from './now-schema.ts';
import { noNumbers } from './project-panel.ts';
import {
  projectLinks,
  projectPath,
  projectRowLabel,
  projectsByGroup,
  releasesFeed,
  type SiteProject,
} from './projects.ts';
import { curlTarget, identityLine, nav, nowPage, site, siteUrl, textRule } from './site.ts';
import { type Note, notePath } from './til.ts';
import { rabatStamp } from './words.ts';
import {
  isoDay,
  meanwhile,
  nothingYet,
  type Post,
  pagesToRead,
  postPath,
  postsByTag,
} from './writing.ts';

/** A built `.txt` page. Every text page ends in one newline. */
export const textFile = (body: string) =>
  new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

/**
 * An empty /writing or /til as its page says it: what will be there, its feeds, and the pages
 * that have something to read now.
 */
const empty = (
  words: string,
  feeds: { rss: string; atom: string },
  counts: Parameters<typeof pagesToRead>[0]
) => [
  `  ${words}`,
  `  ${'RSS'.padEnd(10)} ${siteUrl}${feeds.rss}`,
  `  ${'Atom'.padEnd(10)} ${siteUrl}${feeds.atom}`,
  '',
  `  ${meanwhile}:`,
  ...pagesToRead(counts).map((item) => `  ${item.label.padEnd(10)} ${siteUrl}${item.href}`),
];

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
  projects: readonly SiteProject[],
  origin: string
): string {
  const writing = posts
    .slice(0, 10)
    .flatMap((post) => dated(post.data.date, post.data.title, postPath(post.id)));
  const til = notes
    .slice(0, 5)
    .flatMap((note) => dated(note.data.date, note.data.title, notePath(note.id)));
  // The row home shows: the name, the label beside it, and where it leads.
  const rows = projects.map((project) => ({
    slug: project.slug,
    label: projectRowLabel(project, posts),
  }));
  const slugWidth = Math.max(0, ...rows.map(({ slug }) => slug.length)) + 2;
  const labelWidth = Math.max(0, ...rows.map(({ label }) => label.length));
  const projectLines = rows.map(
    ({ slug, label }) =>
      `  ${slug.padEnd(slugWidth)}${labelWidth === 0 ? '' : `${label.padEnd(labelWidth)}  `}${siteUrl}${projectPath(slug)}`
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
    ...[...nav, nowPage].map((item) => `  ${item.label.padEnd(12)} ${siteUrl}${item.href}`),
    `  ${'RSS'.padEnd(12)} ${siteUrl}${feedPaths().rss}`,
    `  ${'Atom'.padEnd(12)} ${siteUrl}${feedPaths().atom}`,
    `  ${'Email'.padEnd(12)} ${site.email}`,
    `  ${'GitHub'.padEnd(12)} ${site.links.github}`,
    `  ${'In colour'.padEnd(12)} curl ${curlTarget(origin)}/room`,
    '',
  ].join('\n');
}

/** /writing: every post with its summary, then the tags. `notes` counts for the empty page's links. */
export function renderWritingText(posts: readonly Post[], notes: readonly Note[]): string {
  const tags = [...postsByTag(posts).keys()];
  return [
    `Writing | ${site.name}`,
    textRule,
    ...(posts.length === 0
      ? empty(nothingYet.writing, feedPaths(), { posts: 0, notes: notes.length })
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

/** /til: every note in full, as the page shows them. `posts` counts for the empty page's links. */
export function renderTilText(notes: readonly Note[], posts: readonly Post[]): string {
  const articles = notes.map(noteArticle);
  return [
    `Today I learned | ${site.name}`,
    textRule,
    ...(articles.length === 0
      ? empty(nothingYet.til, feedPaths({ til: true }), { posts: posts.length, notes: 0 })
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

/**
 * /projects: what each project is, its posts and its status, under the page's headings, then
 * the Noctalia plugins when there are any.
 */
export function renderProjectsText(
  projects: readonly SiteProject[],
  posts: readonly Post[],
  plugins: readonly NoctaliaPlugin[]
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
    ...(plugins.length === 0
      ? []
      : [
          textRule,
          pluginsSection.title,
          pluginsSection.intro,
          '',
          ...plugins.flatMap((plugin) => [
            plugin.name,
            `  ${plugin.summary}`,
            `  ${pluginUrl(plugin)}`,
            '',
          ]),
        ]),
    ...footer('/projects').slice(1),
  ].join('\n');
}

/** What a project's page and its text copy show besides the project itself. */
export interface ProjectPageParts {
  posts: readonly Post[];
  /** The project file's Markdown, if it has one. */
  description: string | undefined;
  /** The project's log as its page draws it. */
  shipped: readonly ProjectEvent[];
  /** `hasReleased`'s answer. */
  released: boolean | null;
  receipt: string | null;
  next: Pick<SiteProject, 'slug'> | undefined;
}

/**
 * /projects/<slug>: the summary, how to get it, the description as written, the numbers from
 * the build's snapshot, its log, the posts if there are any, and where to go next, in the
 * page's order.
 */
export function renderProjectText(
  project: SiteProject,
  { posts, description, shipped, released, receipt, next }: ProjectPageParts
): string {
  const path = projectPath(project.slug);
  const facts = projectFacts(project);
  const releases = releasesFeed(project, released);
  const sections: string[][] = [
    [
      `${project.slug} | ${site.name}`,
      ...(project.summary === null ? [] : [project.summary]),
      ...(project.status === null ? [] : [`Status: ${project.status}`]),
      ...(project.install === null ? [] : ['', `  ${project.install}`, '']),
      ...projectLinks(project, released).map(
        ({ lead, label, href }) => `${lead ?? ''}${label}: ${href}`
      ),
    ],
    description === undefined ? [] : [absoluteLinks(description, path).trim()],
    [
      'Numbers',
      ...(facts.length === 0
        ? [`  ${noNumbers(project)}`]
        : facts.map(({ label, value }) => `  ${label}: ${value}`)),
      ...(receipt === null ? [] : [`  ${receipt}`]),
    ],
    shipped.length === 0
      ? []
      : [
          'Recently shipped',
          ...shipped.flatMap((event) => [
            `  ${rabatStamp(event.at).padEnd(13)}  ${describeEvent(event)}`,
            `                 ${event.url}`,
          ]),
        ],
    posts.length === 0
      ? []
      : [
          `Writing about ${project.slug}`,
          ...posts.flatMap((post) => dated(post.data.date, post.data.title, postPath(post.id))),
        ],
    [
      ...(releases === null ? [] : [`Follow releases: ${releases}`]),
      ...(next === undefined ? [] : [`Next: ${next.slug} (${siteUrl}${projectPath(next.slug)})`]),
    ],
  ];
  return [
    ...sections
      .filter((lines) => lines.length > 0)
      .flatMap((lines, index) => (index === 0 ? lines : [textRule, ...lines])),
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
    contactLine(identity)
      .map((part) => (typeof part === 'string' ? part : part.label))
      .join(''),
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
 * Where a brewing item's name links: the project's page here when the item is a featured project,
 * by its name or its repository's URL, so a reader stays on the site; else its own `url`.
 */
export function brewingHref({ name, url }: BrewingItem): string | undefined {
  const project = featuredProjects.find(
    ({ slug, repo }) => slug === name || url === `https://github.com/${repo}`
  );
  return project === undefined ? url : projectPath(project.slug);
}

/**
 * /now as plain text, what `curl ayagmar.dev/now` prints (worker/index.ts): the same frontmatter
 * and Markdown body the page renders, the body left as Markdown, which reads as text.
 */
export function renderNowText(
  { updated, brewing }: { updated: Date; brewing: readonly BrewingItem[] },
  body: string
): string {
  const items = brewing.flatMap((item) => {
    const href = brewingHref(item);
    return [
      `  ${item.name}`,
      `    ${item.note}`,
      ...(href === undefined ? [] : [`    ${href.startsWith('/') ? siteUrl + href : href}`]),
    ];
  });
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
