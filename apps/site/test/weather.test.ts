import { staleAfterSeconds, weatherEnvelopeSchema } from '@min7/contracts';
import { describe, expect, it } from 'vitest';
import {
  readWeather,
  type WeatherState,
  weatherCodes,
  weatherMaxAgeMs,
} from '../src/lib/weather.ts';

describe('the weather codes', () => {
  // Open-Meteo's "Weather code descriptions as JSON", copied from https://open-meteo.com/en/docs
  // on 2026-10-26 ("WMO Weather interpretation codes (WW)"). Catches a documented code the
  // room would treat as unknown, an undocumented one it would show, and changed wording.
  const documented: Record<number, string> = {
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Fog',
    48: 'Depositing rime fog',
    51: 'Light drizzle',
    53: 'Moderate drizzle',
    55: 'Dense drizzle',
    56: 'Light freezing drizzle',
    57: 'Dense freezing drizzle',
    61: 'Slight rain',
    63: 'Moderate rain',
    65: 'Heavy rain',
    66: 'Light freezing rain',
    67: 'Heavy freezing rain',
    71: 'Slight snowfall',
    73: 'Moderate snowfall',
    75: 'Heavy snowfall',
    77: 'Snow grains',
    80: 'Slight rain showers',
    81: 'Moderate rain showers',
    82: 'Violent rain showers',
    85: 'Slight snow showers',
    86: 'Heavy snow showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm with slight hail',
    97: 'Heavy thunderstorm',
    99: 'Thunderstorm with heavy hail',
  };

  // The layers, as ADR 0029 groups the codes.
  const layers: Record<WeatherState, number[]> = {
    clear: [0, 1],
    cloudy: [2],
    overcast: [3],
    fog: [45, 48],
    rain: [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82],
    snow: [71, 73, 75, 77, 85, 86],
    storm: [95, 96, 97, 99],
  };

  it('has every documented code and no other, each with its words and one layer', () => {
    const expected = Object.fromEntries(
      Object.entries(layers).flatMap(([state, codes]) =>
        codes.map((code) => [code, [state, documented[code]?.toLowerCase()]])
      )
    );
    expect(Object.keys(expected).sort()).toEqual(Object.keys(documented).sort());
    expect(weatherCodes).toEqual(expected);
  });

  // Five codes against WMO code table 4677 (present weather), as the Japan Oceanographic Data
  // Center publishes it: https://www.jodc.go.jp/data_format/weather-code.html, read 2026-10-26.
  // Open-Meteo's words differ from 4677's (see src/lib/weather.ts), but for these codes the
  // phenomenon is the same, so the layer must be too.
  it.each([
    [45, 'Fog or ice fog, sky invisible no appreciable change during the preceding hour', 'fog'],
    [61, 'Rain, not freezing, continous slight at time of observation', 'rain'],
    [71, 'Continuous fall of snow flakes slight at time of observation', 'snow'],
    [82, 'Rain shower(s), violent', 'rain'],
    [
      95,
      'Thunderstorm, slight or moderate, without hail, but with rain and/or snow at time of observation',
      'storm',
    ],
  ] as const)('shows WMO 4677 code %i (%s) as %s', (code, _wmo, state) => {
    expect(weatherCodes[code]?.[0]).toBe(state);
  });
});

describe('which answers the room shows', () => {
  const now = Date.parse('2026-10-26T14:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const answer = (data: Record<string, unknown> = {}, envelope: Record<string, unknown> = {}) => ({
    source: 'weather',
    version: 1,
    fetchedAt: ago(60_000),
    stale: false,
    data: {
      observedAt: ago(10 * 60_000),
      weatherCode: 61,
      cloudCoverPercent: 100,
      precipitationMm: 0.4,
      windSpeedKmh: 12.6,
      isDay: true,
      temperatureC: 14.4,
      ...data,
    },
    ...envelope,
  });

  it('shows a fresh answer with its words and temperature', () => {
    expect(readWeather(answer(), now)).toEqual({ state: 'rain', words: 'slight rain, 14 °C' });
    expect(readWeather(answer({ temperatureC: null }), now)?.words).toBe('slight rain');
    // -0.4 rounds to -0, which must not print as "-0 °C".
    expect(readWeather(answer({ temperatureC: -0.4 }), now)?.words).toBe('slight rain, 0 °C');
  });

  it('drops weather as old as signals calls stale, from either of its times', () => {
    expect(weatherMaxAgeMs).toBe(staleAfterSeconds.weather * 1000);
    for (const field of ['observedAt', 'fetchedAt']) {
      const at = (ms: number) =>
        field === 'observedAt'
          ? answer({ observedAt: ago(ms) })
          : answer({}, { fetchedAt: ago(ms) });
      // Equal to the limit is still fresh, as in `isStale`; a millisecond more is not.
      expect(readWeather(at(weatherMaxAgeMs), now), field).toBeDefined();
      expect(readWeather(at(weatherMaxAgeMs + 1), now), field).toBeUndefined();
    }
  });

  it.each([
    ['a stale answer', answer({}, { stale: true })],
    // Signals fetched it a minute ago, but Open-Meteo says the values are an hour old.
    ['old model data in a fresh answer', answer({ observedAt: ago(60 * 60_000) })],
    ['a time from the future', answer({}, { fetchedAt: ago(-2 * 60_000 - 1) })],
    ['an unreadable time', answer({ observedAt: 'yesterday' })],
    ['a time that is not a string', answer({}, { fetchedAt: now })],
    ['no data', answer({}, { data: null })],
    ['another source', answer({}, { source: 'listening' })],
    ['another version', answer({}, { version: 2 })],
    ['a code Open-Meteo does not document', answer({ weatherCode: 18 })],
    ['a code past two digits', answer({ weatherCode: 100 })],
    ['a fractional code', answer({ weatherCode: 61.5 })],
    ['a code as a string', answer({ weatherCode: '61' })],
    ['a null code', answer({ weatherCode: null })],
    ['a temperature that is not a number', answer({ temperatureC: '14' })],
    ['an error body', { error: 'internal_error' }],
    ['no body', undefined],
  ])('shows nothing for %s', (_case, body) => {
    expect(readWeather(body, now)).toBeUndefined();
  });

  // Catches the room showing weather from a snapshot the contract rejects, or hiding one it
  // accepts: each value at and past its bounds, of the wrong type, null and missing.
  const values: Record<string, unknown[]> = {
    cloudCoverPercent: [0, 100, -0.1, 100.1],
    precipitationMm: [0, 1000, -1, 1000.1],
    windSpeedKmh: [0, 500, -1, 500.1],
    temperatureC: [-100, 70, -100.1, 70.1, 1e300],
    isDay: [true, false, 1, 'true'],
  };
  it.each(
    Object.entries(values).flatMap(([field, cases]) =>
      [...cases, null, '5', undefined].map((value) => [field, value] as const)
    )
  )('agrees with the contract on %s %j', (field, value) => {
    const body = answer({ [field]: value });
    expect(readWeather(body, now) !== undefined).toBe(
      weatherEnvelopeSchema.safeParse(body).success
    );
  });

  it('believes a server clock up to two minutes ahead', () => {
    expect(readWeather(answer({}, { fetchedAt: ago(-2 * 60_000) }), now)).toBeDefined();
  });
});
