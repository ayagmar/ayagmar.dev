import { describe, expect, it } from 'vitest';
import { featuredProjectSchema, featuredProjects, isProjectSlug } from '../src/index.ts';

describe('featured projects', () => {
  // A bad repo or package name would bend the GitHub or npm request URL signals builds.
  it('are well-formed', () => {
    for (const project of featuredProjects) {
      expect(featuredProjectSchema.parse(project)).toEqual(project);
    }
  });

  // Slugs are URLs and join keys for posts; two projects must never share one.
  it('have unique slugs and repositories', () => {
    const slugs = featuredProjects.map((project) => project.slug);
    const repos = featuredProjects.map((project) => project.repo.toLowerCase());
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(repos).size).toBe(repos.length);
  });

  it('recognise their own slugs only', () => {
    expect(isProjectSlug('pi-mobile')).toBe(true);
    expect(isProjectSlug('Pi-Mobile')).toBe(false);
    expect(isProjectSlug('toString')).toBe(false);
  });
});
