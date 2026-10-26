# 0023. About page and resume PDF from one data file

Status: accepted, 2026-10-26

## Context

The about page and the resume list the same facts: roles, certifications, education, skills. Kept apart, they drift. The resume also has to stay private until the owner has reviewed it, and the owner may prefer a hand-made PDF.

## Decision

- `content/about.json` is the only source. `apps/site/src/data/about.ts` holds its zod schema: unknown fields are rejected, months are `YYYY-MM`, an end month cannot precede its start, roles must be newest first, links must be `https://`. The about page reads it through an Astro content collection (like posts, so `apps/site` never imports a file outside itself); the resume scripts read and validate the file directly. A bad field fails `astro build` and `just resume` with a message naming it.
- The PDF is compiled by Typst 0.15.1 from `resume/resume.typ`, which reads the same JSON with `json()`. It uses only Typst's embedded fonts (`--ignore-system-fonts`) and no document date, so every machine produces the same PDF. The template panics when the content runs past one page, so `just resume` and the site build fail instead of shipping a two-page resume. Month formatting exists twice, in `formatMonth` and in the template; both say so.
- `just resume` writes `resume/build/resume.pdf` (gitignored). `just site-build` depends on it, so CI and Workers Builds always compile the resume and a template error fails the build. Typst comes from `mise.toml` locally and from `scripts/bootstrap.sh` (sha256-checked) in Workers Builds.
- Publishing is a flag, `resume.published`. While `false`, `scripts/ship-resume.ts` copies nothing, `/resume.pdf` is a 404, and the about page shows a disabled "Resume PDF: coming soon" button with a sentence saying why. While `true`, the page links `/resume.pdf` and the build ships `resume/override.pdf` if it exists, else the generated PDF.
- Public data stays minimal: no phone number, street address or birth date in the data file, the page or the PDF; an email only if the owner adds one for this purpose. No photo.
- `apps/site/src/lib/site.ts` keeps the identity the layout, feeds and `astro.config.ts` need, since those cannot read a content collection. A unit test fails when it disagrees with `about.json`.

Tests: schema errors name the field; `ship-resume` runs as a CLI against a temporary repo root for unpublished, published, override and missing-PDF cases; the component renders both states; Playwright checks the committed state end to end (link served as `application/pdf`, or placeholder and 404), that the page and the PDF (`pdftotext`, `pdfinfo -url`) show every fact and verify link in `about.json`, and that oversized content fails the Typst build. The about page runs through the existing axe and 320 px overflow checks.

## Consequences

Editing the resume means editing JSON, not a document. The PDF layout is plain until the visual design; restyling it touches only `resume/resume.typ`. CI needs Typst and poppler-utils (`pdftotext`, `pdfinfo`); without them the PDF tests skip locally and fail under `CI`.
