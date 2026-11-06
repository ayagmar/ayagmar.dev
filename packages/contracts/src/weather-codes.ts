// What each Open-Meteo weather code shows and says (ADR 0029), the one table signals and the
// site share. No zod here: the home page script imports this file.

/**
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
