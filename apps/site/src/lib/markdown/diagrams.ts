// Renders ```mermaid fences in posts to inline SVG at build time with Pele (ADR 0024).
// The SVG carries no style="" attributes: each distinct declaration becomes a class named by
// its hash, recorded on the post's remark frontmatter and written to /diagrams.css, so the
// CSP needs no 'unsafe-inline'. Every diagram needs an accessible name, and any Pele error
// fails the build with the post's path and line.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PeleError, render } from 'pele';
import { type HastNode, type HastPluginEntry, htmlToHast } from 'satteri';

type Element = Extract<HastNode, { type: 'element' }>;

/** Where a post's rendered diagram styles live: class name -> declaration. */
const stylesKey = 'diagramStyles';

/** The font base.css sets, so Pele sizes labels for the font that draws them. */
const fontFamily = 'system-ui, sans-serif';

/** Info string options after `mermaid`: nothing, or a caption that also names the diagram. */
const fenceOptions = /^(?:title="(?<title>[^"]+)")?$/;

/** The diagram styles recorded on a post's `remarkPluginFrontmatter`. */
export function diagramStyles(frontmatter: Record<string, unknown>): Record<string, string> {
  return (frontmatter[stylesKey] as Record<string, string> | undefined) ?? {};
}

/** One stylesheet with a rule per class, sorted so the output is stable. */
export function diagramStylesheet(styles: Record<string, string>[]): string {
  const rules = new Map(styles.flatMap((entry) => Object.entries(entry)));
  return [...rules]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, declaration]) => `.${name}{${declaration}}\n`)
    .join('');
}

function* elements(node: HastNode): Generator<Element> {
  if (node.type === 'element') yield node;
  if ('children' in node) for (const child of node.children) yield* elements(child as HastNode);
}

const textOf = (node: HastNode): string =>
  node.type === 'text'
    ? node.value
    : 'children' in node
      ? node.children.map((child) => textOf(child as HastNode)).join('')
      : '';

/** The text of the elements the SVG's aria-labelledby points at, as Pele wrote them. */
function labelText(svg: Element): string {
  const ids = new Set([svg.properties.ariaLabelledBy ?? []].flat().map(String));
  return [...elements(svg)]
    .filter((element) => ids.has(String(element.properties.id)))
    .map(textOf)
    .join(' ');
}

/** Moves every style="" into a class named by the declaration's hash. */
function classesForStyles(svg: Element, styles: Record<string, string>) {
  for (const element of elements(svg)) {
    const declaration = element.properties.style;
    if (typeof declaration !== 'string') continue;
    const name = `pele-s-${createHash('sha256').update(declaration).digest('hex').slice(0, 12)}`;
    styles[name] = declaration;
    const classes = element.properties.className;
    element.properties.className = [...(Array.isArray(classes) ? classes : []), name];
    delete element.properties.style;
  }
}

/** The hast plugin for `satteri({ hastPlugins })`. */
export const diagrams: HastPluginEntry = (factory) => {
  let file = '<markdown>';
  // Astro passes the body without its frontmatter; positions count from the body's start.
  let bodyStart = 0;
  if (factory.fileURL) {
    const path = fileURLToPath(factory.fileURL);
    const text = readFileSync(path, 'utf8');
    file = relative(process.cwd(), path);
    bodyStart = text.slice(0, Math.max(0, text.indexOf(factory.source))).split('\n').length - 1;
  }
  let count = 0;
  return {
    name: 'min7-diagrams',
    options: { position: true },
    element: {
      filter: ['pre'],
      visit(pre, ctx) {
        const code = pre.children.find(
          (child): child is Element => child.type === 'element' && child.tagName === 'code'
        );
        const fence = code?.data as { lang?: string; meta?: string } | undefined;
        if (code === undefined || fence?.lang !== 'mermaid') return;

        const line = bodyStart + (pre.position?.start.line ?? 0);
        const fail = (at: number, problem: string): never => {
          throw new Error(`${file}:${at}: ${problem}`);
        };
        const caption = fenceOptions.exec(fence.meta?.trim() ?? '')?.groups;
        if (caption === undefined) {
          fail(line, `unknown mermaid fence options "${fence.meta}"; the only one is title="..."`);
        }

        count += 1;
        const id = `diagram-${count}`;
        const source = ctx.textContent(code).replace(/\n$/, '');
        let svgMarkup = '';
        try {
          // Images off: the CSP allows images from this origin only.
          svgMarkup = render(source, { idPrefix: id, fontFamily, images: false }).svg;
        } catch (error) {
          if (!(error instanceof PeleError)) throw error;
          // Pele counts lines from the diagram's first line and may point one past its end.
          const diagramLine = Math.min(error.line, source.split('\n').length);
          const snippet = error.snippet.trim() ? `\n${error.snippet}` : '';
          fail(
            diagramLine > 0 ? line + diagramLine : line,
            `invalid Mermaid (${error.code}): ${error.message.split('\n').at(-1)}${snippet}`
          );
        }

        const [svg] = (htmlToHast(svgMarkup, { fragment: true }) as { children: HastNode[] })
          .children as [Element];
        // The parser keeps xmlns as ":xmlns"; inline SVG in HTML needs no namespace attribute.
        delete svg.properties[':xmlns'];
        svg.properties.role = 'img';
        const title = caption?.title;
        if (title !== undefined && title.trim() !== '') {
          svg.properties.ariaLabelledBy = [`${id}-caption`];
        } else if (title !== undefined || labelText(svg).trim() === '') {
          fail(
            line,
            'a diagram needs an accessible name: add `accTitle: ...` to the diagram or title="..." after ```mermaid'
          );
        }

        const astro = ctx.data.astro;
        if (astro === undefined)
          throw new Error('diagrams: run through Astro, which passes data.astro');
        const styles = { ...diagramStyles(astro.frontmatter) };
        classesForStyles(svg, styles);
        astro.frontmatter = { ...astro.frontmatter, [stylesKey]: styles };

        const children: HastNode[] = [svg];
        if (title !== undefined) {
          children.push({
            type: 'element',
            tagName: 'figcaption',
            properties: { id: `${id}-caption` },
            children: [{ type: 'text', value: title }],
          });
        }
        return {
          type: 'element',
          tagName: 'figure',
          properties: { className: ['diagram'] },
          children,
        };
      },
    },
  };
};
