/**
 * A post or note as text and Markdown (ADR 0040): one model from the entry the page renders, its
 * Markdown body with links that work away from the page, and a renderer for each format.
 */
import { type MdastNode, markdownToMdast } from 'satteri';
import { site, siteUrl } from './site.ts';
import { type Note, notePath, noteSummary } from './til.ts';
import { isoDay, type Post, postPath } from './writing.ts';

export interface Article {
  title: string;
  date: Date;
  updated?: Date | undefined;
  summary: string;
  tags: readonly string[];
  draft: boolean;
  path: string;
  /** What the page puts before each id its Markdown makes: a note's name (ADR 0028). */
  idPrefix: string;
  body: string;
}

export const postArticle = ({ id, data, body }: Post): Article => ({
  ...data,
  path: postPath(id),
  idPrefix: '',
  body: body ?? '',
});

export const noteArticle = (note: Note): Article => ({
  ...note.data,
  summary: noteSummary(note),
  path: notePath(note.id),
  idPrefix: `${note.id}-`,
  body: note.body ?? '',
});

type Edit = { start: number; end: number; text: string };

function* nodes(node: MdastNode): Generator<MdastNode> {
  yield node;
  if ('children' in node) for (const child of node.children) yield* nodes(child as MdastNode);
}

const span = (node: MdastNode) => ({
  start: node.position?.start.offset ?? 0,
  end: node.position?.end.offset ?? 0,
});

const applied = (source: string, edits: readonly Edit[]) =>
  edits
    .toSorted((a, b) => b.start - a.start)
    .reduce(
      (text, { start, end, text: next }) => text.slice(0, start) + next + text.slice(end),
      source
    );

/**
 * `body` with the target of every link, image and link definition absolute, read through the
 * Markdown parser so a link shown in code stays as written. A `#fragment` goes to the page, whose
 * ids carry `idPrefix`. Raw HTML is left alone: a `.md` URL has the page's base, so its relative
 * links resolve the same.
 */
export function absoluteLinks(body: string, path: string, idPrefix = ''): string {
  const page = new URL(path, siteUrl).href;
  const edits = [...nodes(markdownToMdast(body))].flatMap((node): Edit[] => {
    if (node.type !== 'link' && node.type !== 'image' && node.type !== 'definition') return [];
    const { url } = node;
    const target = url.startsWith('#')
      ? `${page}#${idPrefix}${url.slice(1)}`
      : new URL(url, page).href;
    const { start, end } = span(node);
    // Searched from the end: the link's text comes before its target and may repeat it.
    const at = body.lastIndexOf(url, end);
    return url === '' || at < start || target === url
      ? []
      : [{ start: at, end: at + url.length, text: target }];
  });
  return applied(body, edits);
}

/** What a terminal shows for a diagram: the name every diagram must have (ADR 0024), its description. */
function diagramLine(
  { meta, value }: { meta?: string | null | undefined; value: string },
  page: string
) {
  const name = /title="([^"]+)"/.exec(meta ?? '')?.[1] ?? /^\s*accTitle:\s*(.+)$/m.exec(value)?.[1];
  const description = /^\s*accDescr:\s*(.+)$/m.exec(value)?.[1];
  return [`[Diagram: ${name}]`, ...(description === undefined ? [] : [description]), page].join(
    '\n'
  );
}

/** The body as a terminal reads it: Markdown reads as text, Mermaid source does not. */
export function textBody({ body, path, idPrefix }: Article): string {
  const portable = absoluteLinks(body, path, idPrefix);
  const page = new URL(path, siteUrl).href;
  const edits = [...nodes(markdownToMdast(portable))].flatMap((node): Edit[] =>
    node.type === 'code' && node.lang === 'mermaid'
      ? [{ ...span(node), text: diagramLine(node, page) }]
      : []
  );
  return applied(portable, edits).trim();
}

/** The dates under a title: `2026-10-24`, or `2026-10-24, updated 2026-10-30`. */
export const articleDates = ({ date, updated }: Pick<Article, 'date' | 'updated'>) =>
  updated === undefined ? isoDay(date) : `${isoDay(date)}, updated ${isoDay(updated)}`;

/** What `curl ayagmar.dev/writing/<slug>` prints. */
export function renderArticleText(article: Article): string {
  const rule = '-'.repeat(72);
  return [
    `${article.title} | ${site.name}`,
    article.draft ? `Draft, ${articleDates(article)}` : articleDates(article),
    ...(article.tags.length === 0 ? [] : [`Tags: ${article.tags.join(', ')}`]),
    rule,
    textBody(article),
    rule,
    `  ${'Page'.padEnd(10)} ${siteUrl}${article.path}`,
    `  ${'Markdown'.padEnd(10)} ${siteUrl}${article.path}.md`,
    `  ${'Home'.padEnd(10)} ${siteUrl}`,
    '',
  ].join('\n');
}

/** A JSON string is a YAML string, so any title or summary survives the frontmatter. */
const yaml = JSON.stringify;

/**
 * The `.md` copy: frontmatter for the facts the page shows around the body, then the title and
 * the body as written, links made absolute and Mermaid fences kept, since their source is what
 * an agent can read.
 */
export function renderArticleMarkdown(article: Article): string {
  return [
    '---',
    `title: ${yaml(article.title)}`,
    `author: ${yaml(site.author)}`,
    `date: ${isoDay(article.date)}`,
    ...(article.updated === undefined ? [] : [`updated: ${isoDay(article.updated)}`]),
    `summary: ${yaml(article.summary)}`,
    ...(article.tags.length === 0 ? [] : [`tags: ${yaml(article.tags)}`]),
    ...(article.draft ? ['draft: true'] : []),
    `canonical: ${siteUrl}${article.path}`,
    '---',
    '',
    `# ${article.title}`,
    '',
    absoluteLinks(article.body, article.path, article.idPrefix).trim(),
    '',
  ].join('\n');
}
