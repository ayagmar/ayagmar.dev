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

export type WeatherState = 'clear' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'storm';

/** Every code Open-Meteo documents: the layer the window shows, and the words it says. */
export const weatherCodes: Readonly<Record<number, readonly [WeatherState, string]>> = {
  0: ['clear', 'clear sky'],
  1: ['clear', 'mainly clear'],
  2: ['cloudy', 'partly cloudy'],
  3: ['cloudy', 'overcast'],
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
  /** The last instant (ms) the room may show it. */
  until: number;
}

const time = (value: unknown) => (typeof value === 'string' ? Date.parse(value) : Number.NaN);

/**
 * The weather in a `/v1/weather` answer if the room may show it at `now`, else undefined: a
 * fresh (`stale: false`) weather envelope, both its times readable, neither more than two
 * minutes ahead nor older than the limit, a known code, a temperature that is a number or null.
 */
export function readWeather(body: unknown, now: number): Weather | undefined {
  const { source, version, stale, fetchedAt, data } = Object(body);
  if (source !== 'weather' || version !== 1 || stale !== false) return;
  const { observedAt, weatherCode, temperatureC } = Object(data);
  const fetched = time(fetchedAt);
  const observed = time(observedAt);
  const until = Math.min(fetched, observed) + weatherMaxAgeMs;
  const known = Number.isInteger(weatherCode) && weatherCodes[weatherCode];
  // An unreadable time is NaN, and every comparison with NaN is false.
  if (!(known && until >= now && Math.max(fetched, observed) <= now + skewMs)) return;
  if (temperatureC !== null && !Number.isFinite(temperatureC)) return;
  const [state, words] = known;
  return {
    state,
    // `|| 0`: -0.4 rounds to -0, which would print as "-0".
    words: temperatureC === null ? words : `${words}, ${Math.round(temperatureC) || 0} °C`,
    until,
  };
}
