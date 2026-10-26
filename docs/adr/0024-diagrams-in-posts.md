# 0024. Diagrams in posts

Status: accepted, 2026-10-26

## Context

Posts need diagrams: flowcharts, sequences, small charts. Mermaid is the common text format for them, but Mermaid.js renders in the browser, ships hundreds of kilobytes of JavaScript and writes inline styles. The site sends no JavaScript except the search island, and its CSP has no `'unsafe-inline'` for styles or scripts (ADR 0019).

## Decision

` ```mermaid ` fences in posts are rendered to inline SVG at build time with [Pele](https://pele.run), a Mermaid renderer with no runtime dependencies. Astro 7 renders Markdown with Sätteri; `apps/site/src/lib/markdown/diagrams.ts` is a Sätteri hast plugin registered in the `markdown.processor` of `astro.config.ts`. It replaces each fence's `<pre>` with `<figure class="diagram">` holding the SVG.
- **No inline styles.** Pele puts `style="..."` on the root `<svg>` and some shapes. The plugin moves each distinct declaration into a class named `pele-s-<first 12 hex of its SHA-256>` and records the class on the post's `remarkPluginFrontmatter`. `/diagrams.css` (`src/pages/diagrams.css.ts`) collects the classes of every published post into one stylesheet, and only post pages with a diagram link it. The classes travel with the rendered post, so they survive Astro's content cache. The CSP is unchanged.
- **No JavaScript.** Pele runs only during the build. The SVG is fixed at its natural size and scales down with `max-width: 100%`; the figure scrolls sideways if a diagram ever cannot shrink.
- **Theme.** Colors and font come only from Pele's `--pele-*` variables, set in `base.css` with light and dark values (`prefers-color-scheme`). Pele measures labels for `system-ui, sans-serif`, the font `base.css` uses.
- **Accessible name, required.** Each SVG gets `role="img"`. Its name is the `title="..."` given after `mermaid` in the fence, shown as a visible `<figcaption>`, or else the diagram's `accTitle`. The visible caption wins so that what readers see and what screen readers announce match. `accDescr` becomes the description. A diagram with neither name fails the build. `accDescr` alone does not count: a description is not a name.
- **Fence options.** `title="..."` is the only one; anything else fails the build, so a typo does not silently drop a caption.
- **Failures.** Any Pele error (syntax, unknown diagram type, a limit) fails the build with `<file>:<line>` pointing at the line in the post, Pele's message and its snippet. Pele's default limits stay: 50,000 characters of source, 4,000,000 characters of SVG, 5,000 edges.
- **Images off.** Pele is called with `images: false`; the CSP allows images from this origin only.

## Consequences

- Diagrams cost no JavaScript, and their text is in the HTML, so search indexes it.
- Pele's own layout and look, not Mermaid.js's. Pele targets Mermaid 12.1 syntax.
- On phones a wide diagram shrinks with its text. Authors should prefer `flowchart TB` for more than three nodes. Rendering a second, narrow layout for small screens is left to the visual design.
- Styles set inside a diagram (`style`, `classDef`) are fixed colors and do not follow the dark theme.
- `/diagrams.css` has a fixed name, so browsers revalidate it instead of caching it for a year like `/_astro/*`.
- Each diagram is rendered on every build whose content cache is cold; Pele takes milliseconds per diagram.
