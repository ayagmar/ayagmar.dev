import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { markdownToHtml } from 'satteri';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { diagramStyles, diagramStylesheet, diagrams } from '../src/lib/markdown/diagrams.ts';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'min7-diagrams-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const frontmatter = '---\ntitle: A post\n---\n\n';

/** Renders a post the way Astro does: the body alone, with the file it came from. */
async function renderPost(body: string, file = 'post.md') {
  const path = join(dir, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, frontmatter + body);
  const { html, data } = await markdownToHtml(body, {
    hastPlugins: [diagrams],
    fileURL: pathToFileURL(path),
    // What Astro's processor seeds for every document.
    data: {
      astro: {
        frontmatter: {},
        headings: [],
        localImagePaths: new Set(),
        remoteImagePaths: new Set(),
      },
    },
  });
  const styles = diagramStyles(data.astro?.frontmatter ?? {});
  return { html, css: diagramStylesheet([styles]) };
}

const flowchart = [
  '```mermaid',
  'flowchart LR',
  '  accTitle: Publishing a post',
  '  draft[Draft] --> review[Review] --> live[Live]',
  '```',
].join('\n');
const chart = [
  '```mermaid title="Posts per month"',
  'pie',
  '  "September" : 3',
  '  "October" : 5',
  '```',
].join('\n');

describe('mermaid diagrams', () => {
  // Catches SVG that the CSP would break (style attributes) or that screen readers cannot name.
  it('renders a flowchart and a chart to named SVG whose styles are all in the stylesheet', async () => {
    const { html, css } = await renderPost(`Intro.\n\n${flowchart}\n\n${chart}\n`);

    expect(html).not.toMatch(/\sstyle=/);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain('<pre');
    const svgs = [...html.matchAll(/<svg [^>]*>/g)].map(([tag]) => tag);
    expect(svgs).toHaveLength(2);
    for (const svg of svgs) {
      expect(svg).toContain('role="img"');
      expect(svg).toMatch(/aria-labelledby="[^"]+"/);
    }
    expect(html).toContain('<title id="diagram-1-title">Publishing a post</title>');
    expect(html).toContain('<figcaption id="diagram-2-caption">Posts per month</figcaption>');

    const used = new Set([...html.matchAll(/\bpele-s-[0-9a-f]+/g)].map(([name]) => name));
    const defined = new Set([...css.matchAll(/^\.(pele-s-[0-9a-f]+)\{/gm)].map(([, name]) => name));
    expect(used.size).toBeGreaterThan(0);
    expect(defined).toEqual(used);
  });

  // Catches two notes on the /til page both drawing `diagram-1`, which is a duplicate id on that
  // page. A post keeps its ids.
  it('gives a TIL note ids of its own, and leaves a post its own', async () => {
    const note = await renderPost(flowchart, 'til/first-note.md');
    expect(note.html).toContain('id="first-note-diagram-1-title"');
    expect(note.html).not.toContain('id="diagram-1');
    const post = await renderPost(flowchart, 'writing/a-post.md');
    expect(post.html).toContain('id="diagram-1-title"');
  });

  // Catches a diagram that ships with no accessible name, or one that is only whitespace.
  it.each([
    ['no name', '```mermaid\nflowchart LR\n  a --> b\n```'],
    ['a blank caption', '```mermaid title=" "\nflowchart LR\n  a --> b\n```'],
    ['a blank accTitle', '```mermaid\nflowchart LR\n  accTitle: #32;\n  a --> b\n```'],
  ])('fails with the file and line when a diagram has %s', async (_, fence) => {
    await expect(renderPost(`Intro.\n\n${fence}\n`)).rejects.toThrow(
      /post\.md:7: a diagram needs an accessible name: add `accTitle: \.\.\.`/
    );
  });

  // Catches broken Mermaid shipping as a code block or an error image, and errors that do not
  // say where to look.
  it('fails with the file and the line of the mistake on invalid Mermaid', async () => {
    const body = '```mermaid title="Broken"\nflowchart LR\n  a --> b\n  b -->> [c\n```\n';
    await expect(renderPost(body)).rejects.toThrow(/post\.md:8: invalid Mermaid \(syntax\)/);
  });

  // Catches a typo in the fence options being ignored, which would drop the caption.
  it('fails on fence options it does not know', async () => {
    const body = '```mermaid titel="Typo"\nflowchart LR\n  a --> b\n```\n';
    await expect(renderPost(body)).rejects.toThrow(/post\.md:5: unknown mermaid fence options/);
  });
});
