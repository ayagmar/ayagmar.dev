import { z } from 'zod';

/** Every data source the site can show. Adding one starts here. */
export const sourceIds = [
  'listening',
  'shipping',
  'projects',
  'llm-usage',
  'shelf',
  'weather',
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
};
