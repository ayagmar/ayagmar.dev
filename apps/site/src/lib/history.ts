/**
 * "On this day" on /stats (ADR 0030): which `/v1/listening-history` answers the page may show,
 * and the words it shows them with. Pure functions; the /stats script
 * (src/scripts/history.ts) and the tests share them.
 */
import { rabatDate } from '@min7/contracts/rabat';
import { trackBy } from './listening.ts';
import { instantMs, text } from './live.ts';
import type { Markup } from './markup.ts';
import { count, plural } from './plural.ts';

export interface HistoryYear {
  year: number;
  /** Last.fm's count of scrobbles that day. */
  scrobbles: number;
  /** How many of them signals read: fewer than `scrobbles` when the day had more than 200. */
  read: number;
  top: { track: string; artist: string; plays: number };
}

export interface History {
  /** The Rabat date it is for: always today's in Rabat when `readHistory` returns it. */
  describedDate: string;
  /** Past years with scrobbles on that date, newest first; empty when there were none. */
  years: HistoryYear[];
}

const int = (value: unknown, min: number, max: number) =>
  Number.isInteger(value) && (value as number) >= min && (value as number) <= max;

/**
 * The history in a `/v1/listening-history` answer if the page may show it at `now`, else
 * undefined: a fresh (`stale: false`) envelope of this source with a `fetchedAt` the contract accepts,
 * describing today's date in Rabat, by this browser's tzdata, and every value of its type and
 * in the contract's range (`listeningHistorySnapshotSchema`, which the browser does not load).
 * A snapshot for any other date is never shown, however fresh signals says it is.
 */
export function readHistory(body: unknown, now: number): History | undefined {
  const { source, version, stale, fetchedAt, data } = Object(body);
  if (source !== 'listening-history' || version !== 1 || stale !== false) return;
  if (instantMs(fetchedAt, true) === undefined) return;
  const { describedDate, firstYear, years } = Object(data);
  if (describedDate !== rabatDate(now) || !int(firstYear, 2002, 9999)) return;
  if (!Array.isArray(years) || years.length > 24) return;
  const read: HistoryYear[] = [];
  for (const entry of years) {
    const { year, scrobbles, read: counted, top } = Object(entry);
    const { track, artist, plays } = Object(top);
    if (
      !int(year, 2002, 9999) ||
      !int(scrobbles, 1, 1_000_000) ||
      !int(counted, 1, 1_000_000) ||
      !int(plays, 1, 1_000_000) ||
      !text(track, 1024) ||
      !text(artist, 1024)
    )
      return;
    read.push({ year, scrobbles, read: counted, top: { track, artist, plays } });
  }
  return { describedDate, years: read };
}

/**
 * One year's line: `2025: 29 scrobbles. Most played: `, the title and artist, each a link to
 * its Last.fm page, then `, 2 times.` A day signals read only part of says so (`Most played of
 * the 200 read: `), since its top is only the top of those.
 */
export function yearLine({ year, scrobbles, read, top }: HistoryYear): Markup[] {
  return [
    `${year}: ${plural(scrobbles, 'scrobble', 'scrobbles')}. Most played${read < scrobbles ? ` of the ${count(read)} read` : ''}: `,
    ...trackBy(top.track, top.artist, null),
    `, ${plural(top.plays, 'time', 'times')}.`,
  ];
}
