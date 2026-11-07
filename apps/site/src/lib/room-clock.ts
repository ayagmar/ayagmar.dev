/**
 * The part of the room that moves with the clock (ADR 0043): window, lamp and record. It is all
 * home's script needs while the room is live, so it stands apart from the objects `roomState`
 * adds (src/lib/room-state.ts), which reach the browser only when a reader scrubs (ADR 0044). No
 * DOM, no zod, no clock of its own.
 */
import { nowPlaying, nowPlayingWords } from './listening.ts';
import type { Answer } from './live.ts';
import type { Reading, RoomInputs, RoomMoment, RoomSeed, RoomState } from './room-state.ts';
import { isCatHour, isLate, moonAt, moonShown, rabatTime, skyAt, windowWords } from './sky.ts';
import { readWeather } from './weather.ts';

function recordAt(
  reading: RoomInputs['listening'],
  { kind, instant }: RoomMoment
): RoomState['record'] {
  if (reading === null) return { state: 'unknown', line: null, words: null };
  const now =
    kind === 'live' &&
    reading.origin === 'live' &&
    reading.currentUntil !== null &&
    instant <= reading.currentUntil;
  const line = nowPlaying(reading.data, reading.fetchedAt, now);
  return { state: line.playing ? 'playing' : 'resting', line, words: nowPlayingWords(line) };
}

function clockAt(
  { knowsRabat, weather: body }: RoomInputs,
  moment: RoomMoment
): Pick<RoomState, 'window' | 'lamp'> {
  if (moment.kind === 'built') return { window: null, lamp: null };
  const { instant } = moment;
  const sky = skyAt(instant);
  const moon = moonAt(instant);
  const past = moment.kind === 'past' ? moment.day : null;
  const weather = past === null ? (readWeather(body, instant) ?? null) : past.weather;
  return {
    window: {
      sky,
      moon,
      moonShown: moonShown(sky, moon),
      weather,
      label: windowWords(sky, moon, past === null ? weather?.words : past.weatherWords),
    },
    lamp: {
      late: knowsRabat && isLate(instant),
      cat: knowsRabat && isCatHour(instant),
      time: rabatTime(instant),
    },
  };
}

/** Window, lamp and record at `moment`, from `inputs` alone. */
export function roomClock(
  inputs: RoomInputs,
  moment: RoomMoment
): Pick<RoomState, 'window' | 'lamp' | 'record'> {
  return {
    ...clockAt(inputs, moment),
    record: moment.kind === 'past' ? moment.day.record : recordAt(inputs.listening, moment),
  };
}

/** Which parts of the room differ, for a renderer that redraws only those. */
export const changedParts = <State extends Partial<RoomState>>(from: State, to: State) =>
  (Object.keys(to) as (keyof State)[]).filter(
    (part) => JSON.stringify(from[part]) !== JSON.stringify(to[part])
  );

/** The whole set `roomState` needs, from a seed and what only the reader knows. */
export const seededInputs = (seed: RoomSeed, knowsRabat: boolean): RoomInputs => ({
  ...seed.inputs,
  knowsRabat,
  weather: undefined,
});

/** `answer` as a reading from this renderer's own request. */
export const liveReading = <Data>(
  { data, fetchedAt, at }: Answer<Data>,
  currentUntil: number | null
): Reading<Data> => ({ data, fetchedAt, at, origin: 'live', currentUntil });
