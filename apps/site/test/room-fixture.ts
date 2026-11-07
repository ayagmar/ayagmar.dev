import { daysFixtures, historyFixtures } from '@min7/contracts/fixtures';
import type { Series } from '../src/lib/room-day.ts';

/** What `/v1/days/<series>?month=<month>` answers over the shared fixtures. */
export const body = (series: Series, month: string) => ({
  source: series,
  version: 1,
  fetchedAt: '2026-10-26T09:00:00Z',
  stale: false,
  data: {
    days: [...historyFixtures[series].ok.days, ...daysFixtures[series].ok.days].filter(({ date }) =>
      date.startsWith(month)
    ),
  },
});
