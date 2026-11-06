// Weather per day in Rabat (ADR 0038): one dated code for the day and one for the night of a
// date, as near as the record gets to 13 and 22 hours after the date begins. Summaries of the
// date, never the weather at every instant. Codes are kept as Open-Meteo gave them and read by the one table.
import {
  openMeteoArchiveSchema,
  type WeatherSlot,
  type WeatherSnapshot,
  type WeatherStoredDay,
  weatherStoredDaySchema,
} from '@min7/contracts';
import { rabatDate, rabatDayStart } from '@min7/contracts/rabat';
import { weatherCodes } from '@min7/contracts/weather-codes';
import { logEvent } from '../../security/log.ts';
import { type DayValue, mergedRows } from '../../storage/daily.ts';
import type { PullHistory } from '../types.ts';
import {
  checkSnapshot,
  fromUnixSeconds,
  maxUpstreamAheadMs,
  PullError,
  parseBody,
  type UpstreamResponse,
} from './http.ts';

/** Hassan Tower, Rabat, as in the site's room clock (apps/site/src/lib/sky.ts). */
export const rabatPoint = { latitude: '34.0240', longitude: '-6.8228' };

type Slot = 'day' | 'night';

/**
 * Seconds after the date's start each slot aims for. That is 13:00 and 22:00 on a date with no
 * clock change, an hour off on one with; the sun is up at the first and down at the second.
 */
const slotOffsets: Readonly<Record<Slot, number>> = { day: 13 * 3600, night: 22 * 3600 };

const target = (date: string, slot: Slot) => rabatDayStart(date) + slotOffsets[slot];

const known = (slot: WeatherSlot) => weatherCodes[slot.code] !== undefined;

/** How far from its aim a slot's instant is, in ms. */
const distance = (date: string, name: Slot, slot: WeatherSlot) =>
  Math.abs(Date.parse(slot.at) - target(date, name) * 1000);

/**
 * Which of two codes a slot keeps. A known code beats an unknown one, a live one an archived
 * one (the archive reads another cell, and only fills what was missed), then the instant
 * nearest the slot's aim; a tie keeps what is stored, so a re-pull changes nothing.
 */
function mergeSlot(
  date: string,
  name: Slot,
  stored: WeatherSlot | null,
  incoming: WeatherSlot | null
) {
  if (incoming === null) return stored;
  if (stored === null) return incoming;
  if (known(stored) !== known(incoming)) return known(incoming) ? incoming : stored;
  if (stored.origin !== incoming.origin) return stored.origin === 'live' ? stored : incoming;
  return distance(date, name, incoming) < distance(date, name, stored) ? incoming : stored;
}

/** A stored day and a new reading of its date: each slot on its own, none ever emptied. */
export const mergeWeatherDay = (
  date: string,
  stored: WeatherStoredDay,
  incoming: WeatherStoredDay
): WeatherStoredDay => ({
  day: mergeSlot(date, 'day', stored.day, incoming.day),
  night: mergeSlot(date, 'night', stored.night, incoming.night),
});

/** `value` as a day to merge, or none when it fills no slot: an empty row would say nothing. */
export const weatherDayValues = (
  date: string,
  value: WeatherStoredDay
): DayValue<WeatherStoredDay>[] =>
  value.day === null && value.night === null ? [] : [{ date, value }];

/**
 * What the forecast pull says of its date; with no word on the sun, it fills no slot. A reading
 * dated ahead of the clock is not recorded: it would sit nearer its slot's aim than any real
 * reading could, for good. The snapshot is another matter, and the site judges it by itself.
 */
export function weatherDaysHistory(snapshot: WeatherSnapshot): PullHistory | undefined {
  if (Date.parse(snapshot.observedAt) > Date.now() + maxUpstreamAheadMs) {
    logEvent('warn', 'day read failed', { source: 'weather', code: 'upstream_future' });
    return undefined;
  }
  const date = rabatDate(Date.parse(snapshot.observedAt));
  const slot = { code: snapshot.weatherCode, at: snapshot.observedAt, origin: 'live' } as const;
  const values = weatherDayValues(date, {
    day: snapshot.isDay === true ? slot : null,
    night: snapshot.isDay === false ? slot : null,
  });
  return {
    fetchedAt: new Date().toISOString(),
    dates: { from: date, to: date },
    merge: (stored) => ({
      snapshot,
      days: mergedRows(values, stored.days, weatherStoredDaySchema, mergeWeatherDay),
    }),
  };
}

/** The archive's URL for one date: the same place as the forecast pull, no key. */
export const archiveUrl = (date: string) =>
  `https://archive-api.open-meteo.com/v1/archive?${new URLSearchParams({
    ...rabatPoint,
    start_date: date,
    end_date: date,
    hourly: 'weather_code',
    timezone: 'GMT',
    timeformat: 'unixtime',
  })}`;

/**
 * What the archive says of `date`, its two hours picked by instant. An hour it has no code for
 * leaves that slot null: a day the models have not reached is unknown, not clear.
 */
export function weatherDayOf(date: string, response: UpstreamResponse): WeatherStoredDay {
  const { hourly } = parseBody(response, openMeteoArchiveSchema);
  if (hourly.time.length !== hourly.weather_code.length) throw new PullError('upstream_malformed');
  const slot = (name: Slot) => {
    const at = target(date, name);
    const code = hourly.weather_code[hourly.time.indexOf(at)] ?? null;
    return code === null ? null : ({ code, at: fromUnixSeconds(at), origin: 'archive' } as const);
  };
  return checkSnapshot(weatherStoredDaySchema, { day: slot('day'), night: slot('night') });
}
