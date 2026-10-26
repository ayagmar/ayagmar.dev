// The pattern behind `describedDate` (ADR 0030) is the calendar for validators in every
// language. Catches a wrong leap-year rule, a month given the wrong length, or a pattern that
// lets through a date that does not exist, such as 29 February 2100.
import { expect, it } from 'vitest';
import { calendarDatePattern } from '../src/snapshots/listening-history.ts';

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

it('accepts every real date from 1900 to 2100 and no other day of the month', () => {
  const wrong: string[] = [];
  for (let year = 1900; year <= 2100; year++) {
    for (let month = 1; month <= 12; month++) {
      const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
      for (let day = 0; day <= 32; day++) {
        const date = `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
        if (calendarDatePattern.test(date) !== (day >= 1 && day <= days)) wrong.push(date);
      }
    }
  }
  expect(wrong).toEqual([]);
});

it('rejects months outside 1 to 12 and anything but YYYY-MM-DD', () => {
  for (const date of [
    '2026-00-10',
    '2026-13-01',
    '2026-1-01',
    '26-10-26',
    '2026-10-26Z',
    ' 2026-10-26',
  ]) {
    expect(calendarDatePattern.test(date), date).toBe(false);
  }
});
