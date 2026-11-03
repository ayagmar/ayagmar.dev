# Agent instructions

The source for ayagmar.dev: the site (`apps/site`), the signals Worker (`apps/signals`), their
shared contracts (`packages/contracts`) and the producers that run on the owner's machine
(`producers/`). [ARCHITECTURE.md](ARCHITECTURE.md) explains how they fit together;
[CONTRIBUTING.md](CONTRIBUTING.md) has posting, design, CI and commit rules. Read both before a
change; this file only adds what an agent tends to get wrong.

## Commands

Every command is a `just` recipe, and CI runs the same recipes. `just` lists them.

- `just check`: format, lint, types, knip, boundaries, the test and comment checks, schemas and
  every unit test. Run it before a pull request.
- `just test-site`, `just test-signals`, `just test-contracts`, `just test-scripts`,
  `just test-producers`: one unit's tests.
- `just e2e`: the site build and the browser tests, for anything that changes pages or the site
  Worker.
- `just mutate`: mutation testing of contracts and the site's `src/lib`, report only. Slow.

This machine is shared: prefix heavy commands with `nice` and run one at a time.

## Tests

- Each test catches a bug that can really happen, named on a `// Catches …` line above it. If
  you cannot name one, do not write the test.
- Test behaviour through the public interface. Mock only the network, clock and file system,
  with the shared fixtures and MSW at the network boundary (ADR 0016).
- Assert the exact value when it is knowable. `just check-tests` fails a test with no
  assertion, one that asserts only that a mock was called or only `toBeDefined()`,
  `toBeTruthy()`, `not.toBeNull()` or `assert.ok(value)`, any `.only`, and a skip with no
  reason or condition.
- `// check-tests: allow <reason>` on the line or the line above silences one finding. Prefer
  fixing the test.
- Never touch real host state: temporary directories, a temporary `HOME`, no real network.

## Comments

- Say why: a constraint, an ADR, a platform fact, the bug a test catches. Do not restate the
  next line, narrate steps or describe history; git has the history.
- `just check-comments` fails on narration and history phrases ("first we", "now we",
  "previously", "used to", "this function", "note that", "simply" and a few more), and on a
  TODO or FIXME without an issue number or URL.

## Decisions

Record decisions in `docs/adr/NNNN-title.md`, copying the shape of the latest one. Amend an ADR
in its Status line when a later change alters it. New dependencies need a line in ADR 0020 and
an exact version.
