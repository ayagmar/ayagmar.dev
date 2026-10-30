import { snapshotFixtures } from '@min7/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { heatLevels, heatRange, projectsSummary } from '../src/data/format.ts';

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

describe('heatLevels', () => {
  const now = new Date('2026-10-26T09:00:00Z');

  // Catches an off-by-one at either end of the strip (today and the oldest day), events outside
  // it drawn anyway, and busy days not reading hotter than quiet ones.
  it('puts each event on its UTC day, today last, and drops what is outside the strip', () => {
    const at = (iso: string) => ({ at: iso });
    const levels = heatLevels(
      [
        at('2026-10-26T00:00:00Z'),
        at('2026-10-26T08:59:00Z'),
        at('2026-10-25T23:59:00Z'),
        at('2026-09-29T00:00:00Z'),
        at('2026-09-28T23:59:00Z'),
        at('2026-10-27T00:00:00Z'),
        ...Array.from({ length: 6 }, () => at('2026-10-20T12:00:00Z')),
      ],
      now
    );
    expect(levels).toHaveLength(28);
    expect(levels.at(-1)).toBe(2);
    expect(levels.at(-2)).toBe(1);
    expect(levels.at(-7)).toBe(4);
    expect(levels[0]).toBe(1);
    expect(levels.filter((level) => level > 0)).toHaveLength(4);
  });

  it('is all zero with no events', () => {
    expect(heatLevels([], now).every((level) => level === 0)).toBe(true);
  });
});

describe('heatRange', () => {
  // Catches the caption's dates drifting from the days heatLevels counts: 28 days ending on the
  // build's UTC day, including across a month and a year end.
  it('names the 28 UTC days the strip covers, ending on the build day', () => {
    expect(heatRange(new Date('2026-10-26T23:59:00Z'))).toEqual({ from: '29 Sept', to: '26 Oct' });
    expect(heatRange(new Date('2027-01-03T00:00:00Z'))).toEqual({ from: '7 Dec', to: '3 Jan' });
  });
});
