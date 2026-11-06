import { z } from 'zod';
import { envelopeSchema, timestampSchema } from '../envelope.ts';

// Wire input: Open-Meteo's forecast API asked for `current=` values only (ADR 0029). Only the
// fields the normalizer reads are declared; zod drops every other key. A value the model has
// no data for comes as null, and stays null: it is never read as 0.

/** Unix seconds that `Date` can still turn into an RFC 3339 timestamp. */
const unixSeconds = z.int().min(0).max(253_402_300_799);

/**
 * A WMO weather interpretation code (WW). Open-Meteo documents which it sends, but any whole
 * number is kept: a failed pull keeps the last snapshot, so rejecting a new code would keep
 * showing the old weather. The site shows none for a code it does not know.
 */
const wwCode = z.int();

const percent = z.number().min(0).max(100);
const millimetres = z.number().min(0).max(1000);
const kmPerHour = z.number().min(0).max(500);
const celsius = z.number().min(-100).max(70);

/**
 * `GET https://api.open-meteo.com/v1/forecast` with `current=weather_code,cloud_cover,
 * precipitation,wind_speed_10m,is_day,temperature_2m`, Celsius, km/h, mm and
 * `timeformat=unixtime`. The units are checked, so a request that changed them fails instead
 * of serving Fahrenheit as Celsius.
 */
export const openMeteoCurrentSchema = z.object({
  current_units: z.object({
    time: z.literal('unixtime'),
    weather_code: z.literal('wmo code'),
    cloud_cover: z.literal('%'),
    precipitation: z.literal('mm'),
    wind_speed_10m: z.literal('km/h'),
    is_day: z.literal(''),
    temperature_2m: z.literal('°C'),
  }),
  current: z.object({
    /** The start of the 15-minute step the values are for. */
    time: unixSeconds,
    weather_code: wwCode.nullable(),
    cloud_cover: percent.nullish(),
    precipitation: millimetres.nullish(),
    wind_speed_10m: kmPerHour.nullish(),
    is_day: z.union([z.literal(0), z.literal(1)]).nullish(),
    temperature_2m: celsius.nullish(),
  }),
});

/**
 * `GET https://archive-api.open-meteo.com/v1/archive` for one date with `hourly=weather_code`,
 * `timezone=GMT` and `timeformat=unixtime` (ADR 0038). An hour the models have not reached yet
 * has a null code.
 */
export const openMeteoArchiveSchema = z.object({
  hourly_units: z.object({ time: z.literal('unixtime'), weather_code: z.literal('wmo code') }),
  hourly: z.object({
    time: z.array(unixSeconds).max(48),
    weather_code: z.array(wwCode.nullable()).max(48),
  }),
});

// Normalized output: what `/v1/weather` serves.

/**
 * Current modelled weather for the Open-Meteo grid cell over Rabat (Hassan Tower, 34.0240 N,
 * 6.8228 W), not a measurement at the tower. Every value but the code is null when the model
 * had none.
 */
export const weatherSnapshotSchema = z.object({
  /** When the values are valid: the start of Open-Meteo's current 15-minute step, in UTC. */
  observedAt: timestampSchema,
  /**
   * WMO weather interpretation code (WW) as Open-Meteo documents it. A code the site does not
   * know is kept, and the site shows no weather for it.
   */
  weatherCode: wwCode,
  cloudCoverPercent: percent.nullable(),
  /** Precipitation over the 15 minutes before `observedAt`. */
  precipitationMm: millimetres.nullable(),
  windSpeedKmh: kmPerHour.nullable(),
  /** Whether the sun is up there, by Open-Meteo. The room's sky follows its own clock instead. */
  isDay: z.boolean().nullable(),
  temperatureC: celsius.nullable(),
});

export type WeatherSnapshot = z.infer<typeof weatherSnapshotSchema>;

/** The `/v1/weather` response. */
export const weatherEnvelopeSchema = envelopeSchema(z.literal('weather'), weatherSnapshotSchema);

/**
 * A code that stands for one part of a date in Rabat (ADR 0038). `at` is the instant it is for:
 * a slot says what the weather was then, not all that part of the day. `live` came from the
 * forecast pull, `archive` from a backfill, which reads another grid cell and other models.
 */
const weatherSlotSchema = z.object({
  code: wwCode,
  at: timestampSchema,
  origin: z.enum(['live', 'archive']),
});

export type WeatherSlot = z.infer<typeof weatherSlotSchema>;

const weatherSlots = {
  /** Sun up, nearest 13:00 in Rabat. Null when nothing was recorded: unknown, never clear. */
  day: weatherSlotSchema.nullable(),
  /** Sun down, nearest 22:00 in Rabat. Null when nothing was recorded: unknown, never clear. */
  night: weatherSlotSchema.nullable(),
};

/** A day of weather as stored in `daily`: its date is the row's key. */
export const weatherStoredDaySchema = z.object(weatherSlots);

export type WeatherStoredDay = z.infer<typeof weatherStoredDaySchema>;

/** A day of `/v1/days/weather`: a summary of the date, not the weather at every instant. */
export const weatherDaySchema = z.object({ date: z.iso.date(), ...weatherSlots });

export type WeatherDay = z.infer<typeof weatherDaySchema>;
