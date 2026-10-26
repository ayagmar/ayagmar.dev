// Open-Meteo: the current modelled weather over Rabat for the room's window (ADR 0029).
import {
  openMeteoCurrentSchema,
  type WeatherSnapshot,
  weatherSnapshotSchema,
} from '@min7/contracts';
import type { PullAdapter } from '../types.ts';
import { checkSnapshot, getJson, PullError, parseBody, type UpstreamResponse } from './http.ts';

// Hassan Tower, Rabat, as in the site's room clock (apps/site/src/lib/sky.ts). Current values
// only, no hourly or daily arrays, in fixed units and Unix time.
const url = `https://api.open-meteo.com/v1/forecast?${new URLSearchParams({
  latitude: '34.0240',
  longitude: '-6.8228',
  current: 'weather_code,cloud_cover,precipitation,wind_speed_10m,is_day,temperature_2m',
  temperature_unit: 'celsius',
  wind_speed_unit: 'kmh',
  precipitation_unit: 'mm',
  timezone: 'GMT',
  timeformat: 'unixtime',
})}`;
// The answer is about 0.5 KiB.
const maxBytes = 16 * 1024;

export const weather: PullAdapter<UpstreamResponse, WeatherSnapshot> = {
  id: 'weather',
  // About 96 requests a day, far under the free API's limits (ADR 0029).
  intervalSeconds: 15 * 60,

  fetch: (_env, signal) => getJson(url, { signal, maxBytes }),

  normalize(raw) {
    const { current } = parseBody(raw, openMeteoCurrentSchema);
    // No weather code is no current conditions: the pull fails and the last snapshot stays
    // until it is too old to show.
    if (current.weather_code === null) throw new PullError('upstream_error');
    return checkSnapshot(weatherSnapshotSchema, {
      observedAt: new Date(current.time * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      weatherCode: current.weather_code,
      cloudCoverPercent: current.cloud_cover ?? null,
      precipitationMm: current.precipitation ?? null,
      windSpeedKmh: current.wind_speed_10m ?? null,
      isDay: current.is_day == null ? null : current.is_day === 1,
      temperatureC: current.temperature_2m ?? null,
    });
  },
};
