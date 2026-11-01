import { type ShippingSnapshot, shippingActivityDaysEnvelopeSchema } from '@min7/contracts';
import { daysFixtures, snapshotFixtures } from '@min7/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { projectsSummary, shippingStrip } from '../src/data/format.ts';

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

describe('shippingStrip', () => {
  const now = new Date('2026-11-01T12:00:00Z');
  const history = shippingActivityDaysEnvelopeSchema.parse({
    source: 'shipping-activity',
    version: 1,
    fetchedAt: '2026-10-26T08:55:00.000Z',
    stale: false,
    data: daysFixtures['shipping-activity'].ok,
  });
  const noHistory = { ...history, fetchedAt: null, data: null };
  const event = (type: 'push' | 'merge' | 'stars', at: string) =>
    ({ type, at }) as ShippingSnapshot['events'][number];
  const shipping = (fetchedAt: string, events: ShippingSnapshot['events']) => ({
    source: 'shipping' as const,
    version: 1 as const,
    fetchedAt,
    stale: false,
    data: { events },
  });
  const events = shipping('2026-10-29T10:00:00Z', [
    event('merge', '2026-10-29T09:00:00Z'),
    event('push', '2026-10-29T08:00:00Z'),
    event('stars', '2026-10-27T08:00:00Z'),
    event('merge', '2026-10-20T23:59:00Z'),
  ]);

  // Catches days before history began drawn as quiet days, a strip that ends on the build day
  // instead of the history's last day, and stars counted as shipping.
  it('draws the history, outlining the days before it began', () => {
    const strip = shippingStrip(history, events, now);
    expect(strip?.cells).toHaveLength(28);
    expect(strip?.cells[0]?.date).toBe('2026-09-29');
    expect(strip?.cells.at(-1)?.date).toBe('2026-10-26');
    expect(strip?.cells.findIndex((cell) => cell.level !== null)).toBe(13);
    expect(strip).toMatchObject({
      from: '12 Oct',
      to: '26 Oct',
      gaps: true,
      countedAt: '26 Oct, 08:55 UTC',
    });
    // 25 Oct: 4 pushes and 12 merges (and stars, which do not count).
    expect(strip?.cells.find((cell) => cell.date === '2026-10-25')?.level).toBe(4);
    // A day with no shipping in the history is 0, not missing.
    expect(strip?.cells.find((cell) => cell.date === '2026-10-14')?.level).toBe(0);
  });

  // The fallback while signals has no history: the events hold at most 50, and the snapshot
  // was taken before the build, so only the days between the oldest event's and the
  // snapshot's are known. Catches the days after a stale snapshot drawn as quiet.
  it('falls back to the events, only over the days they cover', () => {
    const strip = shippingStrip(noHistory, events, now);
    const level = (date: string) => strip?.cells.find((cell) => cell.date === date)?.level;
    expect(strip?.cells.at(-1)?.date).toBe('2026-11-01');
    expect(level('2026-10-19')).toBeNull();
    expect(level('2026-10-20')).toBe(1);
    expect(level('2026-10-27')).toBe(0);
    expect(level('2026-10-29')).toBe(2);
    expect(level('2026-10-30')).toBeNull();
    expect(strip).toMatchObject({
      from: '20 Oct',
      to: '29 Oct',
      gaps: true,
      busy: 2,
      countedAt: '29 Oct, 10:00 UTC',
    });
  });

  it('falls back when the history has no day in the strip, and draws nothing without either', () => {
    const empty = { ...history, data: history.data && { ...history.data, days: [] } };
    expect(shippingStrip(empty, events, now)?.from).toBe('20 Oct');
    expect(shippingStrip(noHistory, shipping('2026-10-29T10:00:00Z', []), now)).toBeNull();
  });
});
