import { feedPaths } from './feed.ts';
import { nav, site, siteUrl } from './site.ts';
import { isoDay, type Post, postPath } from './writing.ts';

const width = 72;

/** The page `curl ayagmar.dev` prints: who, recent writing, where to go next. */
export function renderPlainText(posts: readonly Post[]): string {
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
  return [
    `${site.name} | ${site.author}`,
    `${site.role} in ${site.location}`,
    rule,
    'Writing',
    ...writing,
    rule,
    ...nav.map((item) => `  ${item.label.padEnd(10)} ${siteUrl}${item.href}`),
    `  ${'RSS'.padEnd(10)} ${siteUrl}${feedPaths().rss}`,
    `  ${'Atom'.padEnd(10)} ${siteUrl}${feedPaths().atom}`,
    `  ${'GitHub'.padEnd(10)} ${site.links.github}`,
    '',
  ].join('\n');
}
