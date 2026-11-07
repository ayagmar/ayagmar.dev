/**
 * A post or note as text and Markdown (ADR 0040): one model from the entry the page renders, its
 * Markdown body with links that work away from the page, and a renderer for each format.
 */
import { type MdastNode, markdownToMdast } from 'satteri';
import { site, siteUrl, textRule } from './site.ts';
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

/** The index of the `]` closing the label that opens `source`, past escapes and code spans. */
function labelEnd(source: string): number {
  let depth = 0;
  for (let at = 0; at < source.length; at += 1) {
    const char = source[at];
    if (char === '\\') at += 1;
    else if (char === '`') {
      const code = /^(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/.exec(source.slice(at));
      at += (code?.[0].length ?? 1) - 1;
    } else if (char === '[') depth += 1;
    else if (char === ']') {
      depth -= 1;
      if (depth === 0) return at;
    }
  }
  return -1;
}

/** Where the destination starting after any space at `from` lies; a `<...>` one, inside its brackets. */
function destinationAt(source: string, from: number) {
  const start = from + (/^\s*/.exec(source.slice(from))?.[0].length ?? 0);
  const angled = /^<((?:\\.|[^<>\\\n])*)>/.exec(source.slice(start));
  if (angled !== null) return { start: start + 1, end: start + 1 + (angled[1] ?? '').length };
  let depth = 0;
  let end = start;
  for (; end < source.length; end += 1) {
    const char = source[end] ?? '';
    if (char === '\\') end += 1;
    else if (/\s/.test(char)) break;
    else if (char === '(') depth += 1;
    else if (char === ')') {
      if (depth === 0) break;
      depth -= 1;
    }
  }
  return { start, end };
}

/**
 * `body` with the target of every link, image and link definition absolute. The parser finds each
 * node, and its destination is read from the node's own syntax, after its label, so a title,
 * a label or the prose around it stays as written, and so does a link shown in code. A `#fragment`
 * goes to the page, whose ids carry `idPrefix`. Raw HTML is left alone: a `.md` URL has the
 * page's base, so its relative links resolve the same.
 */
export function absoluteLinks(body: string, path: string, idPrefix = ''): string {
  const page = new URL(path, siteUrl).href;
  const edits = [...nodes(markdownToMdast(body))].flatMap((node): Edit[] => {
    if (node.type !== 'link' && node.type !== 'image' && node.type !== 'definition') return [];
    const { url } = node;
    if (url === '' || URL.canParse(url)) return [];
    const { start, end } = span(node);
    const source = body.slice(start, end);
    const close = labelEnd(source);
    if (source[close + 1] !== (node.type === 'definition' ? ':' : '(')) return [];
    const at = destinationAt(source, close + 2);
    return [
      {
        start: start + at.start,
        end: start + at.end,
        // Valid in a bare destination and inside `<...>`, whose brackets stay outside this edit.
        text: new URL(
          url.startsWith('#') ? `${page}#${idPrefix}${url.slice(1)}` : url,
          page
        ).href.replace(/[\\()<>]/g, '\\$&'),
      },
    ];
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

/** The lines under a title, single or stacked: draft or not, the dates, the tags. */
export function articleMeta({ date, updated, draft, tags }: Article): string[] {
  const dates =
    updated === undefined ? isoDay(date) : `${isoDay(date)}, updated ${isoDay(updated)}`;
  return [
    draft ? `Draft, ${dates}` : dates,
    ...(tags.length === 0 ? [] : [`Tags: ${tags.join(', ')}`]),
  ];
}

/** What `curl ayagmar.dev/writing/<slug>` prints. */
export function renderArticleText(article: Article): string {
  return [
    `${article.title} | ${site.name}`,
    ...articleMeta(article),
    textRule,
    textBody(article),
    textRule,
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
