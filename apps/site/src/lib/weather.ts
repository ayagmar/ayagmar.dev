/**
 * The weather in the room's window (ADR 0029): which `/v1/weather` answers the room may show
 * at all, and what each shows and says by the code table in contracts. Pure functions; the
 * home page script (src/scripts/room.ts) and the tests share them.
 */
import { type WeatherState, weatherCodes } from '@min7/contracts/weather-codes';
import { skewMs } from './live.ts';

/**
 * How old weather may be, from when signals fetched it and from the time Open-Meteo says it
 * is for: `staleAfterSeconds.weather` in contracts, which the browser does not import (zod).
 */
export const weatherMaxAgeMs = 45 * 60_000;

export interface Weather {
  state: WeatherState;
  /** `slight rain, 14 °C`: the words the window's label adds. */
  words: string;
}

/** Null, or a number from `min` to `max`: the contract's range for each snapshot value. */
const within = (value: unknown, min: number, max: number) =>
  value === null || (typeof value === 'number' && value >= min && value <= max);

/**
 * The weather in a `/v1/weather` answer if the room may show it at `now`, else undefined: a
 * fresh (`stale: false`) weather envelope, both its times readable, neither more than two
 * minutes ahead nor older than the limit, a known code, and every other value present, of its
 * type and in the contract's range (`weatherSnapshotSchema`, which the browser does not load).
 */
export function readWeather(body: unknown, now: number): Weather | undefined {
  const { source, version, stale, fetchedAt, data } = Object(body);
  if (source !== 'weather' || version !== 1 || stale !== false) return;
  const {
    observedAt,
    weatherCode,
    cloudCoverPercent,
    precipitationMm,
    windSpeedKmh,
    isDay,
    temperatureC,
  } = Object(data);
  // A time is a string no older than the limit (equal is fresh, as in `isStale`) and no more
  // than `skewMs` ahead. An unreadable one is NaN, and every comparison with NaN is false.
  const fresh = (value: unknown) =>
    within(typeof value === 'string' && Date.parse(value), now - weatherMaxAgeMs, now + skewMs);
  // `+weatherCode` is only the same value for a number; a fractional one is not in the table.
  const known = weatherCode === +weatherCode && weatherCodes[weatherCode];
  if (
    !(
      known &&
      fresh(fetchedAt) &&
      fresh(observedAt) &&
      within(cloudCoverPercent, 0, 100) &&
      within(precipitationMm, 0, 1000) &&
      within(windSpeedKmh, 0, 500) &&
      within(temperatureC, -100, 70) &&
      (isDay === null || isDay === !!isDay)
    )
  )
    return;
  const [state, words] = known;
  return {
    state,
    // `|| 0`: -0.4 rounds to -0, which would print as "-0".
    words: temperatureC === null ? words : `${words}, ${Math.round(temperatureC) || 0} °C`,
  };
}
