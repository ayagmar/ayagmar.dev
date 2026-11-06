import { describe, expect, it } from 'vitest';
import { heatLevels } from '../src/lib/heat.ts';

describe('heatLevels', () => {
  // Catches a fixed scale, which put most days of a real month on the palest square.
  it('spreads small counts over every level', () => {
    expect(heatLevels([1, 1, 2, 2, 3, 3, 4, 4])).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
  });

  // Catches one huge day washing out the rest, as a scale up to the maximum would.
  it('keeps the other days apart under one huge day', () => {
    expect(heatLevels([10, 20, 30, 40, 1_000_000])).toEqual([1, 1, 2, 3, 4]);
  });

  // Catches a quiet day drawn as unknown, or a day nobody knows about drawn as quiet: ADR 0041's
  // difference, which a level over the shown days must keep.
  it('keeps no record and a recorded zero out of the levels', () => {
    expect(heatLevels([null, 0, 5, 0, null])).toEqual([null, 0, 1, 0, null]);
    expect(heatLevels([null, 0])).toEqual([null, 0]);
    expect(heatLevels([])).toEqual([]);
  });
});
