import { snapshotFixtures } from '@min7/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { projectsSummary } from '../src/data/format.ts';

describe('projectsSummary', () => {
  it('gives the star total when GitHub answered for every project', () => {
    expect(projectsSummary(snapshotFixtures.projects.ok.projects)).toBe(
      '8 featured projects, 235 stars in total.'
    );
  });

  // Unknown counts must not be added as zero and passed off as the total.
  it('says "at least" when some star counts are unknown', () => {
    expect(projectsSummary(snapshotFixtures.projects.partial.projects)).toBe(
      '7 featured projects, at least 233 stars; GitHub did not answer for 1.'
    );
  });
});
