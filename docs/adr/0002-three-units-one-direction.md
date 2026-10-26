# 0002. Monorepo with three units and one dependency direction

Status: accepted, 2026-10-26

## Context

The site renders data; the signals Worker collects it. If either imports the other's internals, they can no longer deploy, roll back or fail independently, and adding a data source would touch pages.

## Decision

One pnpm workspace with three units: `apps/site` (`@min7/site`), `apps/signals` (`@min7/signals`) and `packages/contracts` (`@min7/contracts`), all private. Both apps depend on `contracts`; `contracts` depends on neither; the apps never depend on each other.

The rule is enforced mechanically:
- TypeScript project references: each app's `tsconfig.json` references only `packages/contracts`.
- pnpm's strict `node_modules`: an undeclared workspace package does not resolve.
- `scripts/check-boundaries.ts` (`just boundaries`, run in CI) checks package manifests (names and `file:`/`link:`/`workspace:` paths), tsconfig references and `paths` aliases, and every import, re-export, dynamic import and triple-slash reference in `.ts` and `.js` files. In `.astro` and `.svelte` files it reads the frontmatter and scripts with TypeScript and also scans the whole file, template expressions and `<script src>` included, with a conservative pattern match, since TypeScript cannot parse markup. Specifiers are resolved with TypeScript's own resolver and the unit's compiler options, so aliases and relative paths are caught. A unit may reach an allowed unit by package name only; a relative path into another unit or outside every unit fails.
- `scripts/check-boundaries.test.ts` builds a throwaway workspace per forbidden edge and asserts the check fails on each one. It runs on Node's built-in test runner, with Node's type stripping, so the check adds no dependency.

Biome's `noRestrictedImports` was not used: it matches specifiers as written and cannot see what an alias or relative path resolves to.

## Consequences

Adding a data source touches `signals` and `contracts` only. Code the apps would like to share goes into `contracts` (if it is part of the contract) or is duplicated.
