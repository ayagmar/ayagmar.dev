import { z } from 'zod';

/** Every data source the site can show. Adding one starts here. */
export const sourceIds = [
  'listening',
  'shipping',
  'projects',
  'llm-usage',
  'shelf',
  'weather',
  'listening-history',
  'desktop',
  'monkeytype',
] as const;

export const sourceIdSchema = z.enum(sourceIds);

export type SourceId = z.infer<typeof sourceIdSchema>;

/**
 * Seconds after the last successful fetch or push before a snapshot is reported as stale.
 * Each threshold is a few missed updates of that source's schedule.
 */
export const staleAfterSeconds: Readonly<Record<SourceId, number>> = {
  // Last.fm pulled every minute; now playing is meaningless after a quarter hour.
  listening: 15 * 60,
  // repo-pulse feed pulled every 15 minutes.
  shipping: 6 * 60 * 60,
  // GitHub and npm pulled daily.
  projects: 2 * 24 * 60 * 60,
  // llm-usage-metrics pushes from the owner's machine at least daily.
  'llm-usage': 2 * 24 * 60 * 60,
  // trellis pushes a daily summary.
  shelf: 3 * 24 * 60 * 60,
  // Open-Meteo pulled every 15 minutes; the room's window drops weather this old (ADR 0029).
  weather: 45 * 60,
  // Last.fm history for today's date in Rabat, refreshed every 7 hours (ADR 0030). The page
  // also hides a snapshot for any other date, stale or not.
  'listening-history': 24 * 60 * 60,
  // Pushed at login and daily from the owner's desktop (ADR 0032).
  desktop: 2 * 24 * 60 * 60,
  // Monkeytype pulled every 6 hours; a day is three missed pulls (ADR 0033). Personal bests
  // stay true for years, so this is about the pull, never about when a best was set.
  monkeytype: 24 * 60 * 60,
};
