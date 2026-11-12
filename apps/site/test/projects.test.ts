import type { Project, ProjectEventsSnapshot, ProjectsSnapshot } from '@min7/contracts';
import { snapshotFixtures } from '@min7/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { noNumbers } from '../src/lib/project-panel.ts';
import { projectFact } from '../src/lib/project-row.ts';
import { projectSchema } from '../src/lib/project-schema.ts';
import { projectScreenshotsSchema } from '../src/lib/project-screenshot.ts';
import {
  checkProjectFiles,
  hasReleased,
  morePostsAbout,
  nextProject,
  projectsByGroup,
  releasesFeed,
  siteProjects,
} from '../src/lib/projects.ts';
import { type Post, publishedEntries } from '../src/lib/writing.ts';

const post = (
  id: string,
  day: number,
  projects: Post['data']['projects'],
  draft = false
): Post => ({
  id,
  data: {
    title: id,
    date: new Date(Date.UTC(2026, 9, day)),
    summary: id,
    tags: [],
    draft,
    projects,
  },
});

describe('project files', () => {
  it('reject a slug that is not a featured project, naming it', () => {
    const result = projectSchema.safeParse({
      slug: 'runner-d',
      status: 'active',
      group: 'self-hosted',
    });
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      expect.stringMatching(/^"runner-d" is not a featured project/),
    ]);
  });

  // Catches half a day and night pair passing, which would show no screenshot in one theme, and a
  // screenshot whose file was never added reaching the page as a broken image.
  it('reject a screenshot with only one theme, or a file that is not in src/assets/projects', () => {
    const image = (file: string) => ({
      file,
      source: 'https://raw.githubusercontent.com/ayagmar/runnerd/0000000/x.webp',
      fetched: '2026-11-12',
    });
    const messages = (screenshot: object) =>
      projectScreenshotsSchema
        .safeParse({ screenshots: [{ slug: 'runnerd', ...screenshot }] })
        .error?.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    expect(messages({ alt: 'The history view.', day: image('runnerd-day.webp') })).toEqual([
      'screenshots.0: must have either image, or both day and night',
    ]);
    expect(messages({ alt: 'The history view.', image: image('runnerd.webp') })).toEqual([
      'screenshots.0.image.file: src/assets/projects/runnerd.webp does not exist; add the file or drop the field',
    ]);
  });

  // A copied file whose slug was not edited would replace the other project's description.
  it('fail on a slug that differs from the file name and list projects without a file', () => {
    const { errors, missing } = checkProjectFiles([
      { id: 'runnerd', slug: 'runnerd' },
      { id: 'ccdesk', slug: 'runnerd' },
    ]);
    expect(errors).toEqual([
      'content/projects/ccdesk.md: slug "runnerd" must match the file name (ccdesk)',
    ]);
    expect(missing).not.toContain('runnerd');
    expect(missing).toContain('ccdesk');
  });
});

describe('site projects', () => {
  it('list every featured project, file order first, with no numbers when signals had none', () => {
    const projects = siteProjects(
      [{ slug: 'dotfiles', status: 'spec', group: 'desktop', order: 1 }],
      null
    );
    expect(projects[0]).toMatchObject({ slug: 'dotfiles', status: 'spec', live: null });
    expect(projects.map((project) => project.slug)).toEqual([
      'dotfiles',
      'llm-usage-metrics',
      'pi-mobile',
      'pi-extmgr',
      'ccdesk',
      'niri-computer-use',
      'runnerd',
      'pi-codex-web-search',
      'pi-promptsmith',
      'claude-modmgr',
      'repo-pulse',
      'agents-skills',
      'kipple',
    ]);
  });

  // Catches a project dropped from contracts coming back from a snapshot that still names it: a
  // row signals stored before the drop, or an older signals answering during a deploy.
  it('list no project the snapshot names that contracts no longer do', () => {
    const live = snapshotFixtures.projects.ok.projects;
    const dropped = live.slice(0, 1).map((project) => ({ ...project, slug: 'headroom' }));
    const stale = [...live, ...dropped];
    expect(siteProjects([], stale).map((project) => project.slug)).toEqual(
      siteProjects([], live).map((project) => project.slug)
    );
  });

  // Catches a project with no file dropping off /projects, or a group taking the place of a
  // stronger one: groups follow their best project, and members keep their rank.
  it('group projects in rank order, with those that have no file last', () => {
    const groups = projectsByGroup(
      siteProjects(
        [
          { slug: 'runnerd', status: 'active', group: 'self-hosted' },
          { slug: 'pi-mobile', status: 'active', group: 'agents' },
          { slug: 'niri-computer-use', status: 'active', group: 'desktop' },
          { slug: 'llm-usage-metrics', status: 'active', group: 'agents' },
        ],
        null
      ).slice(0, 8)
    );
    expect(groups.map((group) => [group.title, group.projects.map((p) => p.slug)])).toEqual([
      ['Coding agents', ['llm-usage-metrics', 'pi-mobile']],
      ['Linux desktop', ['niri-computer-use']],
      ['Self-hosted', ['runnerd']],
      ['Other', ['pi-extmgr', 'ccdesk', 'pi-codex-web-search', 'pi-promptsmith']],
    ]);
  });

  // Catches a page saying "right now" about numbers signals never fetches (ADR 0009).
  it('say why a project has no numbers', () => {
    const said = siteProjects([], null)
      .filter(({ slug }) => slug === 'llm-usage-metrics' || slug === 'agents-skills')
      .map(noNumbers);
    expect(said).toEqual([
      'No live numbers for llm-usage-metrics right now.',
      "I don't fetch numbers for agents-skills.",
    ]);
  });

  it('cross-link at most three other published posts on the project, newest first', () => {
    const posts = publishedEntries(
      [
        post('current', 10, ['runnerd']),
        post('oldest', 1, ['runnerd']),
        post('newest', 20, ['runnerd', 'ccdesk']),
        post('draft', 25, ['runnerd'], true),
        post('elsewhere', 22, ['ccdesk']),
        post('middle', 5, ['runnerd']),
        post('older', 3, ['runnerd']),
      ],
      false
    );
    expect(morePostsAbout(posts, 'runnerd', 'current').map((p) => p.id)).toEqual([
      'newest',
      'middle',
      'older',
    ]);
    expect(morePostsAbout(posts, 'ccdesk', 'newest').map((p) => p.id)).toEqual(['elsewhere']);
  });
});

describe("a project row's fact", () => {
  const live: Project = {
    ...(snapshotFixtures.projects.ok.projects[0] as Project),
    stars: 3,
    npm: { package: 'pi-extmgr', monthlyDownloads: 40 },
    latestRelease: null,
  };
  const release = {
    tag: 'v0.4.0',
    url: 'https://github.com/ayagmar/runnerd/releases/tag/v0.4.0',
    publishedAt: '2026-10-20T10:00:00Z',
  };

  // Catches the order or a floor slipping: a handful of stars beating 2,604 downloads, or a
  // rounding that turns 2,604 into "3k" or "2,604k".
  it.each([
    [{ stars: 118 }, '118 stars'],
    [{ stars: 1240 }, '1.2k stars'],
    [{ stars: 9, npm: { package: 'pi-extmgr', monthlyDownloads: 2604 } }, '2.6k downloads a month'],
    [{ npm: { package: 'pi-extmgr', monthlyDownloads: 100 } }, '100 downloads a month'],
    [{ latestRelease: release }, 'v0.4.0'],
    [{ stars: null, npm: { package: 'pi-extmgr', monthlyDownloads: null } }, ''],
    [{}, ''],
  ])('says %j as %j', (change, words) => {
    expect(projectFact({ ...live, ...change })).toBe(words);
  });

  // Catches a row reading `modmgr--v0.5.0`, the tag a monorepo release tool writes, where a
  // reader expects the version, and a plain tag or one with no version being rewritten.
  it.each([
    ['modmgr--v0.5.0', 'v0.5.0'],
    ['claude-modmgr@1.2.3', 'v1.2.3'],
    ['claude-modmgr-v1.2.3', 'v1.2.3'],
    ['v0.1.5', 'v0.1.5'],
    ['nightly', 'nightly'],
  ])('says the tag %j as %j', (tag, words) => {
    expect(projectFact({ ...live, latestRelease: { ...release, tag } })).toBe(words);
  });

  // Catches a number made up for a project signals has no entry for.
  it('says nothing without a snapshot entry', () => {
    expect(projectFact(null)).toBe('');
  });
});

describe('the end of a project page', () => {
  const live = (snapshotFixtures.projects.ok as ProjectsSnapshot).projects;
  const log = snapshotFixtures['project-events'].ok as ProjectEventsSnapshot;
  const projects = siteProjects([], live);
  const find = (slug: string) => {
    const project = projects.find((candidate) => candidate.slug === slug);
    if (project === undefined) throw new Error(`${slug} is not featured`);
    return project;
  };

  // Catches "No release yet" said about a project whose release is only in the log (one signals
  // does not pull, like agents-skills), or said while neither source had the project, which a
  // failed pull would make look like a project without releases.
  it('knows a release from either source, and says nothing when neither has the project', () => {
    expect(hasReleased(find('runnerd'), null)).toBe(true);
    expect(hasReleased(find('agents-skills'), log)).toBe(true);
    expect(hasReleased(find('pi-mobile'), log)).toBe(false);
    expect(hasReleased(find('kipple'), log)).toBe(false);
    expect(hasReleased(find('kipple'), null)).toBeNull();
    expect(hasReleased(find('pi-mobile'), null)).toBe(false);
    expect(releasesFeed(find('runnerd'), true)).toBe(
      'https://github.com/ayagmar/runnerd/releases.atom'
    );
    expect(releasesFeed(find('kipple'), null)).toBeNull();
  });

  // Catches "Next" following the registry order instead of the grouped order /projects shows,
  // and a dead end on the last project.
  it('leads to the next project in /projects order, from the last to the first', () => {
    const grouped = siteProjects(
      [
        { slug: 'runnerd', status: 'active', group: 'self-hosted' },
        { slug: 'kipple', status: 'active', group: 'agents' },
        { slug: 'llm-usage-metrics', status: 'active', group: 'agents' },
      ],
      null
    ).filter((project) => project.group !== null);
    // Registry order llm-usage-metrics, runnerd, kipple; /projects shows the agents group first.
    expect(grouped.map((project) => nextProject(grouped, project.slug)?.slug)).toEqual([
      'kipple',
      'llm-usage-metrics',
      'runnerd',
    ]);
    expect(nextProject(grouped.slice(0, 1), 'llm-usage-metrics')).toBeUndefined();
  });
});
