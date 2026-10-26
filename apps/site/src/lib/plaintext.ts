import type { ProjectSlug } from '@min7/contracts';
import { feedPaths } from './feed.ts';
import { postCount, postsAbout, projectPath } from './projects.ts';
import { nav, site, siteUrl } from './site.ts';
import { isoDay, type Post, postPath } from './writing.ts';

const width = 72;

/** The page `curl ayagmar.dev` prints: who, recent writing, projects, where to go next. */
export function renderPlainText(posts: readonly Post[], projects: readonly ProjectSlug[]): string {
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
  const slugWidth = Math.max(0, ...projects.map((slug) => slug.length)) + 2;
  const projectLines = projects.map(
    (slug) =>
      `  ${slug.padEnd(slugWidth)}${postCount(postsAbout(posts, slug).length).padEnd(10)}${siteUrl}${projectPath(slug)}`
  );
  return [
    `${site.name} | ${site.author}`,
    `${site.role} in ${site.location}`,
    rule,
    'Writing',
    ...writing,
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
