/**
 * The weather in the room's window (ADR 0029): what each Open-Meteo weather code shows and
 * says, and which `/v1/weather` answers the room may show at all. Pure functions; the home
 * page script (src/scripts/room.ts) and the tests share them.
 *
 * Codes: Open-Meteo's "WMO Weather interpretation codes (WW)" at https://open-meteo.com/en/docs
 * (read 2026-10-26), every code it documents and its wording. These are WMO's present-weather
 * codes as Open-Meteo uses them for model output, not WMO code table 4677 itself: in 4677,
 * 00 to 03 describe how clouds developed over the past hour, where Open-Meteo means clear to
 * overcast, and where 4677 says "moderate or heavy" (57, 67, 81, 86) Open-Meteo names one.
 */

export type WeatherState = 'clear' | 'cloudy' | 'overcast' | 'fog' | 'rain' | 'snow' | 'storm';

/** Every code Open-Meteo documents: the layer the window shows, and the words it says. */
export const weatherCodes: Readonly<Record<number, readonly [WeatherState, string]>> = {
  0: ['clear', 'clear sky'],
  1: ['clear', 'mainly clear'],
  2: ['cloudy', 'partly cloudy'],
  3: ['overcast', 'overcast'],
  45: ['fog', 'fog'],
  48: ['fog', 'depositing rime fog'],
  51: ['rain', 'light drizzle'],
  53: ['rain', 'moderate drizzle'],
  55: ['rain', 'dense drizzle'],
  56: ['rain', 'light freezing drizzle'],
  57: ['rain', 'dense freezing drizzle'],
  61: ['rain', 'slight rain'],
  63: ['rain', 'moderate rain'],
  65: ['rain', 'heavy rain'],
  66: ['rain', 'light freezing rain'],
  67: ['rain', 'heavy freezing rain'],
  71: ['snow', 'slight snowfall'],
  73: ['snow', 'moderate snowfall'],
  75: ['snow', 'heavy snowfall'],
  77: ['snow', 'snow grains'],
  80: ['rain', 'slight rain showers'],
  81: ['rain', 'moderate rain showers'],
  82: ['rain', 'violent rain showers'],
  85: ['snow', 'slight snow showers'],
  86: ['snow', 'heavy snow showers'],
  95: ['storm', 'thunderstorm'],
  96: ['storm', 'thunderstorm with slight hail'],
  97: ['storm', 'heavy thunderstorm'],
  99: ['storm', 'thunderstorm with heavy hail'],
};

/**
 * How old weather may be, from when signals fetched it and from the time Open-Meteo says it
 * is for: `staleAfterSeconds.weather` in contracts, which the browser does not import (zod).
 */
export const weatherMaxAgeMs = 45 * 60_000;

/** A server clock up to this far ahead of the visitor's is still believable. */
const skewMs = 2 * 60_000;

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
