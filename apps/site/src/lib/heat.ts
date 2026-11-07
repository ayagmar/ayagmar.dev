/**
 * The level of every heat view (ADR 0037): the shipping strip, a year's calendar and the LLM usage
 * year. Levels are quantiles of the days shown, so a fixed scale cannot leave most squares on one
 * step and one huge day cannot wash out the rest. The ramp they index is `--heat-1` to `--heat-4`
 * in src/styles/base.css.
 */
import { dayMs, isoDate, utcDate } from '@min7/contracts/rabat';

export type HeatLevel = 0 | 1 | 2 | 3 | 4;

/** What a heat view's caption says of its days without a record, by how it draws them. */
export const noRecordWords = (look: 'outlined' | 'faint') => `${look} days have no record`;

/** The same as a sentence of its own, for a view's text alternative. */
export const noRecordSentence = (look: 'outlined' | 'faint') =>
  `${look === 'faint' ? 'Faint' : 'Outlined'} days have no record.`;

/**
 * A level per day, in order: null for a day without a record, 0 for a recorded zero, and 1 to 4
 * for the quartile of the non-zero days shown. Equal counts share a level.
 */
export function heatLevels(counts: readonly (number | null)[]): (HeatLevel | null)[] {
  const used = counts.filter((count) => count !== null && count > 0) as number[];
  used.sort((a, b) => a - b);
  const quartiles = [0.25, 0.5, 0.75].map((q) => used[Math.floor(q * (used.length - 1))] as number);
  return counts.map((count) => {
    if (count === null) return null;
    if (count === 0) return 0;
    return (1 + quartiles.filter((quartile) => count > quartile).length) as HeatLevel;
  });
}

/**
 * The LLM usage calendar: a cell per day for the `weeks` ending on `end`, a column per week from
 * Monday, and a level: null for a date `days` does not hold, 0 for one it holds with no tokens,
 * then 1 to 4. A missing date is unknown, never a quiet day. The year on /stats and the room's
 * framed screen are this one drawing at two sizes.
 */
export function heatmap(
  days: readonly { date: string; totalTokens: number }[],
  end: string,
  weeks = 53
) {
  const last = utcDate(end);
  const weekday = (new Date(last).getUTCDay() + 6) % 7;
  const first = last - ((weeks - 1) * 7 + weekday) * dayMs;
  const byDate = new Map(days.map((day) => [day.date, day.totalTokens]));
  const cells = [];
  for (let time = first; time <= last; time += dayMs) {
    const date = isoDate(time);
    cells.push({ date, tokens: byDate.get(date) });
  }
  const levels = heatLevels(cells.map((cell) => cell.tokens ?? null));
  const busiest = cells.reduce<(typeof cells)[number] | undefined>(
    (top, cell) => ((cell.tokens ?? 0) > (top?.tokens ?? 0) ? cell : top),
    undefined
  );
  return {
    from: isoDate(first),
    to: end,
    activeDays: levels.filter(Boolean).length,
    busiest,
    gaps: levels.includes(null),
    cells: cells.map((cell, index) => ({ ...cell, level: levels[index] ?? null })),
  };
}
