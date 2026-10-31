// How the LLM usage panel on /stats words a snapshot (ADR 0014): token units, agent shares,
// the year heatmap and what is left out. The build and the browser draw the same markup.
import type { LlmUsageSnapshot } from '@min7/contracts';
import { snapshotFixtures } from '@min7/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import {
  dateRange,
  heatmap,
  hours,
  llmUsagePanel,
  share,
  tokens,
} from '../src/lib/llm-usage-panel.ts';
import type { Markup } from '../src/lib/markup.ts';

const ok = snapshotFixtures['llm-usage'].ok as LlmUsageSnapshot;
const taken = '2026-10-26T08:00:00Z';
/** The words the panel shows, each element's apart. */
const words = (nodes: Markup[]): string =>
  nodes.map((node) => (typeof node === 'string' ? node : ` ${words(node.children)} `)).join('');
const text = (data: LlmUsageSnapshot) => words(llmUsagePanel(data, taken)).replace(/\s+/g, ' ');

describe('tokens', () => {
  // Catches a unit picked from the raw count, so 999,960 reads 1,000.0K, or 950K reads 1.0M.
  it.each([
    [0, '0'],
    [999, '999'],
    [1_000, '1.0K'],
    [950_000, '950.0K'],
    [999_960, '1.0M'],
    [1_800_000_000, '1.8B'],
    [41_049_000_000, '41.0B'],
    [2_500_000_000_000, '2.5T'],
  ])('writes %i as %s', (count, words) => {
    expect(tokens(count)).toBe(words);
  });
});

describe('share', () => {
  // Catches a sliver shown as 0%, and one agent shown as all of it while another has some.
  it.each([
    [0, '0%'],
    [0.004, '<1%'],
    [0.0099, '<1%'],
    [0.01, '1%'],
    [0.6498, '65%'],
    [0.996, '99%'],
    [1, '100%'],
  ])('writes %f as %s', (fraction, words) => {
    expect(share(fraction)).toBe(words);
  });
});

describe('the panel', () => {
  it('shows the month, the week, the agents and the streak as of the snapshot', () => {
    const shown = text(ok);
    expect(shown).toContain('This month 1–26 Oct Last 7 days 20–26 Oct');
    expect(shown).toContain('Tokens 61.3M 16.4M');
    expect(shown).toContain('Agent hours 144 hours 60 hours');
    expect(shown).toContain('Claude Code 39.8M 65% Codex 15.3M 25% pi 6.2M 10%');
    expect(shown).toContain('Streak on 26 Oct: 4 days, longest 23 days.');
  });

  // Catches a dollar amount published before the owner decides to.
  it('shows no cost', () => {
    expect(JSON.stringify(llmUsagePanel(ok, taken))).not.toMatch(/\$|USD|152\.8|310\.45|98\.1/);
  });

  // Catches an agent under 1% shown as 0%, or dropped.
  it('shows an agent under 1% as <1%', () => {
    const agents = [
      { agent: 'Claude Code', costUsd: null, totalTokens: 995_000, tokenShare: 0.995 },
      { agent: 'droid', costUsd: null, totalTokens: 5_000, tokenShare: 0.005 },
    ];
    const shown = text({ ...ok, monthToDate: { ...ok.monthToDate, agents } });
    expect(shown).toContain('Claude Code 995.0K 99% droid 5.0K <1%');
  });

  // Catches an empty month drawn as an empty list or a broken heatmap.
  it('says so when there are no agents and no days', () => {
    const shown = text(snapshotFixtures['llm-usage'].minimal as LlmUsageSnapshot);
    expect(shown).toContain('No agent use this month yet.');
    expect(shown).not.toContain('Tokens per day');
  });

  // Catches a producer without hours shown as 0 hours, and a real 0 hidden.
  it('tells hours not sent from zero hours', () => {
    const { activeMs: _m, ...month } = ok.monthToDate;
    const { activeMs: _w, ...week } = ok.last7Days;
    const none = text({ ...ok, monthToDate: month, last7Days: week });
    expect(none).not.toContain('Agent hours');
    expect(none).not.toContain('not my hours at the keyboard');
    const partial = text({ ...ok, monthToDate: month, last7Days: { ...week, activeMs: 0 } });
    expect(partial).toContain('Agent hours unknown 0 hours');
  });

  it('rounds hours for display only', () => {
    expect(hours(517_889_547)).toBe('144 hours');
    expect(hours(34_932_547)).toBe('9.7 hours');
    expect(hours(3_600_000)).toBe('1 hour');
    expect(hours(0)).toBe('0 hours');
  });
});

describe('dateRange', () => {
  it.each([
    ['2026-10-01', '2026-10-26', '1–26 Oct'],
    ['2026-09-28', '2026-10-04', '28 Sept–4 Oct'],
    ['2026-10-01', '2026-10-01', '1 Oct'],
  ])('writes %s to %s as %s', (from, to, words) => {
    expect(dateRange(from, to)).toBe(words);
  });
});

describe('heatmap', () => {
  // Catches a column that does not start on Monday, a last day other than the snapshot's, or a
  // year one week short.
  it('draws 53 weeks from Monday, ending on the snapshot date', () => {
    // 26 October 2026 is a Monday: 52 full weeks and one day.
    const heat = heatmap(ok.days, '2026-10-26');
    expect(heat.cells).toHaveLength(52 * 7 + 1);
    expect(heat.from).toBe('2025-10-27');
    expect(new Date(`${heat.from}T00:00:00Z`).getUTCDay()).toBe(1);
    expect(heat.cells.at(-1)?.date).toBe('2026-10-26');
  });

  // Catches levels scaled to the busiest day, which washes out every other day.
  it('levels days by quartile, zero and missing days at 0', () => {
    const days = [100, 200, 300, 400, 1_000_000, 0].map((totalTokens, i) => ({
      date: `2026-10-${String(20 + i).padStart(2, '0')}`,
      costUsd: null,
      totalTokens,
    }));
    const heat = heatmap(days, '2026-10-26');
    expect(heat.cells.slice(-7).map((cell) => cell.level)).toEqual([1, 1, 2, 3, 4, 0, 0]);
    expect(heat.activeDays).toBe(5);
    expect(heat.busiest?.date).toBe('2026-10-24');
  });
});
