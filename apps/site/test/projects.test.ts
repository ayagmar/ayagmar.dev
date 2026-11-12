import { snapshotFixtures } from '@min7/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { noNumbers } from '../src/lib/project-panel.ts';
import { projectSchema } from '../src/lib/project-schema.ts';
import {
  checkProjectFiles,
  morePostsAbout,
  projectsByGroup,
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
