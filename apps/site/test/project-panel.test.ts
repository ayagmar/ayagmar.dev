import type { ProjectsSnapshot, ShippingEvent, ShippingSnapshot } from '@min7/contracts';
import { snapshotFixtures } from '@min7/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import type { Element } from '../src/lib/markup.ts';
import { markupLines } from '../src/lib/markup-text.ts';
import { projectEvents, projectLog, projectStats } from '../src/lib/project-panel.ts';
import { projectRepos, siteProjects } from '../src/lib/projects.ts';

const shipping = snapshotFixtures.shipping.ok as ShippingSnapshot;
const projects = (snapshotFixtures.projects.ok as ProjectsSnapshot).projects;

const merge = (
  repo: string,
  at: string,
  number: number,
  title = 'fix: a thing'
): ShippingEvent => ({
  type: 'merge',
  repo,
  at,
  url: `https://github.com/${repo}/pull/${number}`,
  number,
  title,
});

describe("a project's log", () => {
  // Catches pushes and stars, or another repository's merges, showing as this project's work.
  it('lists only the releases and merges of its repository, newest first', () => {
    expect(
      projectEvents(shipping.events, ['ayagmar/pi-extmgr']).map((event) => [event.type, event.at])
    ).toEqual([
      ['release', '2026-10-21T19:38:02.122Z'],
      ['merge', '2026-10-21T19:37:11.530Z'],
      ['merge', '2026-10-21T18:37:02.705Z'],
      ['merge', '2026-10-21T18:32:32.963Z'],
    ]);
  });

  // Catches a renamed repository losing the events recorded under its old name, or GitHub's
  // case-free names hiding events whose case differs.
  it('follows a renamed repository under both names, whatever their case', () => {
    const runnerd = projects.find((project) => project.slug === 'runnerd');
    if (runnerd === undefined) throw new Error('no runnerd in the projects fixture');
    const renamed = siteProjects([], [{ ...runnerd, repo: 'ayagmar/runner-d' }]).find(
      (project) => project.slug === 'runnerd'
    );
    if (renamed === undefined) throw new Error('runnerd is not featured');
    const repos = projectRepos(renamed);
    expect(repos).toEqual(['ayagmar/runnerd', 'ayagmar/runner-d']);
    const events = [
      merge('ayagmar/Runner-D', '2026-11-02T10:00:00Z', 9),
      merge('ayagmar/runnerd', '2026-11-01T10:00:00Z', 8),
    ];
    expect(projectEvents(events, repos).map((event) => event.at)).toEqual([
      '2026-11-02T10:00:00Z',
      '2026-11-01T10:00:00Z',
    ]);
  });

  // Catches an empty box on a project with nothing recent (a quiet, private or unknown
  // repository, or a feed that never answered).
  it('is nothing at all when the feed has nothing for the project', () => {
    expect(projectLog(shipping.events, ['ayagmar/headroom'])).toEqual([]);
    expect(projectLog([], ['ayagmar/runnerd'])).toEqual([]);
  });

  // Catches a log that runs down the page: five open, the rest folded where no JavaScript is needed.
  it('keeps five open and folds the rest, each line time first and linked to GitHub', () => {
    const log = projectLog(shipping.events, ['ayagmar/ccdesk']);
    const [open, fold] = log as Element[];
    expect([open?.tag, open?.children.length, fold?.tag]).toEqual(['ul', 5, 'details']);
    expect(fold?.children[0]).toEqual({ tag: 'summary', attrs: {}, children: ['4 earlier ones'] });
    expect(markupLines(log)).toEqual([
      '  25 Oct, 11:48 released v0.5.13',
      '  25 Oct, 11:47 merged #74: chore: update Claude Code data (claude-agent-sdk 0.3.310)',
      '  25 Oct, 02:35 released v0.5.12',
      '  25 Oct, 02:34 merged #73: fix(ui): scroll and layout paper cuts',
      '  25 Oct, 01:43 released v0.5.11',
      '  25 Oct, 01:42 merged #72: chore: update Claude Code data (claude-agent-sdk 0.3.310)',
      '  25 Oct, 01:38 merged #71: chore(deps): consolidate dependency upgrades',
      '  21 Oct, 20:52 released v0.5.10',
      '  21 Oct, 20:50 merged #65: chore: update Claude Code data (claude-agent-sdk 0.3.306)',
    ]);
  });

  // Catches a merge whose title is blank reading "merged #12: " with nothing after it.
  it('names a merge without a title by its number', () => {
    expect(
      markupLines(
        projectLog([merge('ayagmar/runnerd', '2026-11-02T10:00:00Z', 12, ' ')], ['ayagmar/runnerd'])
      )
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
