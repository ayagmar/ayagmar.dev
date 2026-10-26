import { describe, expect, it } from 'vitest';
import { projectSchema } from '../src/lib/project-schema.ts';
import { checkProjectFiles, morePostsAbout, siteProjects } from '../src/lib/projects.ts';
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
    const result = projectSchema.safeParse({ slug: 'runner-d', status: 'active' });
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
    const projects = siteProjects([{ slug: 'headroom', status: 'spec', order: 1 }], null);
    expect(projects[0]).toMatchObject({ slug: 'headroom', status: 'spec', live: null });
    expect(projects.map((project) => project.slug)).toEqual([
      'headroom',
      'llm-usage-metrics',
      'ccdesk',
      'pi-mobile',
      'pi-extmgr',
      'runnerd',
      'kipple',
      'niri-computer-use',
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
