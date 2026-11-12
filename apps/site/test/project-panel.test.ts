import type { ProjectEvent, ProjectEventsSnapshot, ProjectsSnapshot } from '@min7/contracts';
import { snapshotFixtures } from '@min7/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import type { Element } from '../src/lib/markup.ts';
import { markupLines } from '../src/lib/markup-text.ts';
import { projectEvents, projectLog, projectStats } from '../src/lib/project-panel.ts';

const logs = snapshotFixtures['project-events'].ok as ProjectEventsSnapshot;
const projects = (snapshotFixtures.projects.ok as ProjectsSnapshot).projects;

const merge = (repo: string, at: string, number: number, title: string): ProjectEvent => ({
  type: 'merge',
  repo,
  at,
  url: `https://github.com/${repo}/pull/${number}`,
  number,
  title,
});

describe("a project's log", () => {
  // Catches one project's log drawn on another's page, or a log kept for a project the newest
  // snapshot leaves out (made private, deleted or moved to another account).
  it("is the project's own entry, and nothing for a project the snapshot leaves out", () => {
    expect(projectEvents(logs, 'ccdesk').every((event) => event.repo === 'ayagmar/ccdesk')).toBe(
      true
    );
    expect(projectEvents(logs, 'ccdesk')).toHaveLength(20);
    const without = { projects: logs.projects.filter((project) => project.slug !== 'ccdesk') };
    expect(projectEvents(without, 'ccdesk')).toEqual([]);
    expect(projectEvents(null, 'ccdesk')).toEqual([]);
  });

  // Catches an empty box on a project with nothing shipped yet.
  it('is nothing at all when the project has no release or merge', () => {
    expect(projectLog(projectEvents(logs, 'dotfiles'))).toEqual([]);
  });

  // Catches a log that runs down the page: five open, the rest folded where no JavaScript is needed.
  it('keeps five open and folds the rest, each line time first and linked to GitHub', () => {
    const log = projectLog(projectEvents(logs, 'ccdesk').slice(0, 9));
    const [open, fold] = log as Element[];
    expect([open?.tag, open?.children.length, fold?.tag]).toEqual(['ul', 5, 'details']);
    expect(fold?.children[0]).toEqual({ tag: 'summary', attrs: {}, children: ['4 earlier ones'] });
    expect(markupLines(log)).toEqual([
      "  29 Oct, 21:53 merged #80: fix(core): read credential variables in a remote MCP server's URL as empty",
      '  29 Oct, 20:56 released v0.5.14',
      '  25 Oct, 11:48 released v0.5.13',
      '  25 Oct, 02:35 released v0.5.12',
      '  25 Oct, 02:34 merged #73: fix(ui): scroll and layout paper cuts',
      '  25 Oct, 01:43 released v0.5.11',
      '  25 Oct, 01:38 merged #71: chore(deps): consolidate dependency upgrades',
      '  21 Oct, 20:52 released v0.5.10',
      '  20 Oct, 17:43 released v0.5.9',
    ]);
  });

  // Catches a merge whose title is blank reading "merged #12: " with nothing after it.
  it('names a merge without a title by its number', () => {
    expect(
      markupLines(projectLog([merge('ayagmar/runnerd', '2026-11-02T10:00:00Z', 12, ' ')]))
    ).toEqual(['  2 Nov, 10:00 merged #12']);
  });
});

describe("a project's numbers", () => {
  // Catches a project with no release yet showing an empty or broken release row.
  it('leave out the release of a project that has none', () => {
    const entry = projects.find((project) => project.slug === 'pi-mobile') ?? null;
    expect(markupLines(projectStats({ slug: 'pi-mobile', pulled: true }, entry))).toEqual([
      '  Language: Kotlin',
      '  Stars: 115',
    ]);
  });

  // Catches a project missing from the snapshot (no answer from GitHub, or gone private)
  // rendering empty rows, and a `pull: false` project promising numbers that never come.
  it('say why there are none', () => {
    expect(markupLines(projectStats({ slug: 'runnerd', pulled: true }, null))).toEqual([
      'No live numbers for runnerd right now.',
    ]);
    expect(markupLines(projectStats({ slug: 'kipple', pulled: false }, null))).toEqual([
      "I don't fetch numbers for kipple.",
    ]);
  });
});
