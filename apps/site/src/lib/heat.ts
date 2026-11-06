/**
 * The level of every heat view (ADR 0037): the shipping strip, a year's calendar and the LLM usage
 * year. Levels are quantiles of the days shown, so a fixed scale cannot leave most squares on one
 * step and one huge day cannot wash out the rest. The ramp they index is `--heat-1` to `--heat-4`
 * in src/styles/base.css.
 */
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
