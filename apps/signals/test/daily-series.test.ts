// Listening and weather per day (ADR 0038): the pulls that record them, the rule that decides
// what stays, the backfill, and a Worker from before this change on the same D1.
import { env } from 'cloudflare:workers';
import {
  type ListeningSnapshot,
  type ListeningStoredDay,
  listeningDaysEnvelopeSchema,
  listeningEnvelopeSchema,
  llmUsageDaysEnvelopeSchema,
  type WeatherStoredDay,
  weatherDaysEnvelopeSchema,
  weatherEnvelopeSchema,
} from '@min7/contracts';
import { rawFixtures, snapshotFixtures } from '@min7/contracts/fixtures';
import { rabatDayStart } from '@min7/contracts/rabat';
import { upstreamHandlers } from '@min7/contracts/testing';
import { setupNetwork } from '@msw/cloudflare';
import { HttpResponse, http } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { listening } from '../src/adapters/pull/listening.ts';
import { dayReadsDue, mergeListeningDay } from '../src/adapters/pull/listening-days.ts';
import { weather } from '../src/adapters/pull/weather.ts';
import { mergeWeatherDay, weatherDayOf } from '../src/adapters/pull/weather-days.ts';
import { runScheduled } from '../src/cron/run.ts';
import { D1SnapshotStore } from '../src/storage/d1.ts';
import { clearState, fetchApi, snapshotRow, sourceHealth } from './helpers.ts';

const network = setupNetwork();
network.configure({ onUnhandledFrame: 'error' });
beforeAll(() => network.enable());
afterEach(() => {
  network.resetHandlers();
  vi.useRealTimers();
});
afterAll(() => network.disable());
beforeEach(clearState);

const withKey = { ...env, LASTFM_API_KEY: 'test-key' };
const lastfmUrl = 'https://ws.audioscrobbler.com/2.0/';
const archiveUrl = 'https://archive-api.open-meteo.com/v1/archive';

/** A date's scrobbles as Last.fm holds them, newest first; a value of null fails that date. */
type Scrobbled = { total: number; newest?: { at: number; name: string; artist?: string } };

const page = ({ total, newest }: Scrobbled, nowPlaying = false) => ({
  recenttracks: {
    track: [
      ...(nowPlaying
        ? [{ name: 'Still playing', artist: { '#text': 'Live' }, '@attr': { nowplaying: 'true' } }]
        : []),
      ...(newest === undefined
        ? []
        : [
            {
              name: newest.name,
              artist: { '#text': newest.artist ?? 'LTN' },
              date: { uts: String(newest.at) },
            },
          ]),
    ],
    '@attr': {
      user: 'min7_',
      page: '1',
      perPage: '1',
      totalPages: String(total),
      total: String(total),
    },
  },
});

/** Answers the day ranges by date, and counts every Last.fm request; the rest as the fixtures. */
function lastfm(days: Record<string, Scrobbled | null>, nowPlaying = false) {
  const asked: { from: string; to: string; form: string[] }[] = [];
  const seen = { requests: 0, asked };
  network.use(
    http.post(lastfmUrl, async ({ request }) => {
      seen.requests++;
      const form = await request.clone().formData();
      const [from, to] = [Number(form.get('from')), Number(form.get('to'))];
      if (form.get('to') === null || to - from > 25 * 3600) return undefined;
      asked.push({ from: String(from), to: String(to), form: [...form.keys()] });
      const date = Object.keys(days).find((d) => rabatDayStart(d) === from);
      const day = date === undefined ? undefined : days[date];
      if (day === undefined) return HttpResponse.json(page({ total: 0 }));
      if (day === null) return HttpResponse.error();
      return HttpResponse.json(page(day, nowPlaying));
    }),
    ...upstreamHandlers()
  );
  return seen;
}

/** The archive's answer for `date`: `codes[hour]` by UTC hour, null where it has none. */
const archive = (date: string, codes: (hour: number) => number | null) => {
  const start = Date.parse(`${date}T00:00:00Z`) / 1000;
  const hours = Array.from({ length: 24 }, (_, hour) => hour);
  return {
    hourly_units: { time: 'unixtime', weather_code: 'wmo code' },
    hourly: { time: hours.map((h) => start + h * 3600), weather_code: hours.map(codes) },
  };
};

function archiveAnswers(codes: (date: string, hour: number) => number | null) {
  const seen = { requests: 0 };
  network.use(
    http.get(archiveUrl, ({ request }) => {
      seen.requests++;
      const date = new URL(request.url).searchParams.get('start_date') ?? '';
      return HttpResponse.json(archive(date, (hour) => codes(date, hour)));
    })
  );
  return seen;
}

const at = (time: string) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const now = Date.parse(time);
  vi.setSystemTime(now);
  return now;
};

const pullListening = async (time: string) => {
  const now = at(time);
  await runScheduled(withKey, [listening], now);
};

/** One weather pull at `time`, Open-Meteo answering `current`. */
async function pullWeather(
  time: string,
  current: { code: number; isDay: 0 | 1 | null; observedAt?: string }
) {
  const now = at(time);
  const { body } = rawFixtures['open-meteo'].ok as { body: { current: object } };
  network.use(
    http.get('https://api.open-meteo.com/v1/forecast', () =>
      HttpResponse.json({
        ...body,
        current: {
          ...body.current,
          time: (current.observedAt === undefined ? now : Date.parse(current.observedAt)) / 1000,
          weather_code: current.code,
          is_day: current.isDay,
        },
      })
    )
  );
  await runScheduled(env, [weather], now);
}

const row = async <T>(source: string, day: string) => {
  const found = await env.DB.prepare(
    'SELECT json, updated_at FROM daily WHERE source = ? AND day = ?'
  )
    .bind(source, day)
    .first<{ json: string; updated_at: string }>();
  return found === null ? null : { ...found, value: JSON.parse(found.json) as T };
};
const listeningDay = async (day: string) =>
  (await row<ListeningStoredDay>('listening', day))?.value;
const weatherDay = async (day: string) => (await row<WeatherStoredDay>('weather', day))?.value;
const dayCount = async () =>
  (await env.DB.prepare('SELECT count(*) AS n FROM daily').first<{ n: number }>())?.n;

const scrobbleAt = (time: string, name: string) => ({ at: Date.parse(time) / 1000, name });

describe('which dates a listening pull reads', () => {
  // Catches yesterday worked out as 24 hours ago or by UTC date: both name the wrong date
  // around Rabat's midnight while it was at +01.
  it.each([
    [
      '+01, the last minute before midnight is in the new UTC hour',
      '2026-09-19T23:02:00Z',
      ['2026-09-19', '2026-09-20'],
    ],
    ['+01, an hour before', '2026-09-19T22:02:00Z', ['2026-09-18', '2026-09-19']],
    ['+00, midnight', '2026-10-27T00:00:00Z', ['2026-10-26', '2026-10-27']],
    ['+00, the last hour', '2026-10-26T23:04:59Z', ['2026-10-25', '2026-10-26']],
  ])('reads today and yesterday at %s', (_, time, dates) => {
    expect(dayReadsDue(Date.parse(time))).toEqual(dates);
  });

  // Catches a pull that asks on every run: 2,880 more Last.fm requests a day.
  it('reads nothing after the window', () => {
    expect(dayReadsDue(Date.parse('2026-10-26T09:05:00Z'))).toEqual([]);
  });
});

describe('the listening pull', () => {
  // Catches a day built from the ten recent tracks, or bounds that are not the Rabat day.
  it('records the range total and newest scrobble, and serves them through the block route', async () => {
    const seen = lastfm({
      '2026-09-19': { total: 12, newest: scrobbleAt('2026-09-19T22:30:00Z', 'Late') },
      '2026-09-18': { total: 40, newest: scrobbleAt('2026-09-18T21:00:00Z', 'Older') },
    });
    await pullListening('2026-09-19T22:01:00Z');

    expect(seen.asked.map(({ from, to }) => [from, to])).toEqual([
      [String(rabatDayStart('2026-09-18')), String(rabatDayStart('2026-09-19'))],
      [String(rabatDayStart('2026-09-19')), String(rabatDayStart('2026-09-20'))],
    ]);
    const response = await fetchApi('/v1/days/listening?month=2026-09');
    const body = listeningDaysEnvelopeSchema.parse(await response.json());
    expect(body.data).toEqual({
      zone: 'Africa/Casablanca',
      from: '2026-09-01',
      to: '2026-09-30',
      days: [
        {
          date: '2026-09-18',
          count: 40,
          last: { track: 'Older', artist: 'LTN', playedAt: '2026-09-18T21:00:00Z' },
          asOf: '2026-09-19T22:01:00.000Z',
        },
        {
          date: '2026-09-19',
          count: 12,
          last: { track: 'Late', artist: 'LTN', playedAt: '2026-09-19T22:30:00Z' },
          asOf: '2026-09-19T22:01:00.000Z',
        },
      ],
    });
  });

  // Catches the API key leaving the POST form for a URL, and a day read with no user.
  it('asks with the key in the form, for the owner', async () => {
    const seen = lastfm({});
    await pullListening('2026-10-26T09:01:00Z');
    expect(seen.asked[0]?.form).toEqual([
      'method',
      'user',
      'api_key',
      'format',
      'limit',
      'from',
      'to',
    ]);
  });

  // Catches a pull that asks outside the window: its cost is the four requests of ADR 0009.
  it('asks only its four questions outside the window, and writes no day', async () => {
    const seen = lastfm({ '2026-10-26': { total: 3 } });
    await pullListening('2026-10-26T09:30:00Z');
    expect(seen.requests).toBe(4);
    expect(await dayCount()).toBe(0);
  });

  // Catches a quiet day left unrecorded, which would read as a day signals never saw.
  it('records a checked empty range as zero', async () => {
    lastfm({});
    await pullListening('2026-10-26T09:01:00Z');
    expect(await listeningDay('2026-10-25')).toEqual({
      count: 0,
      last: null,
      asOf: '2026-10-26T09:01:00.000Z',
    });
  });

  // Catches the track playing now stored as the day's last scrobble (ADR 0038: never "playing").
  it('leaves out the track playing now', async () => {
    lastfm(
      { '2026-10-26': { total: 1, newest: scrobbleAt('2026-10-26T08:00:00Z', 'Done') } },
      true
    );
    await pullListening('2026-10-26T09:01:00Z');
    expect((await listeningDay('2026-10-26'))?.last?.track).toBe('Done');
  });

  // Catches a failed date written as zero, and a day failure costing the now-playing snapshot.
  it('writes nothing for a date whose read failed, and keeps the rest of the pull', async () => {
    lastfm({
      '2026-10-25': null,
      '2026-10-26': { total: 2, newest: scrobbleAt('2026-10-26T08:00:00Z', 'Fine') },
    });
    await pullListening('2026-10-26T09:01:00Z');
    expect(await listeningDay('2026-10-25')).toBeUndefined();
    expect((await listeningDay('2026-10-26'))?.count).toBe(2);
    const stored = await snapshotRow('listening');
    expect(JSON.parse(stored?.json ?? 'null')).toEqual(snapshotFixtures.listening.ok);
  });

  // Catches an error body or an answer for another range read as a day.
  it.each([
    ['an error in a 200', { error: 29, message: 'Rate limit exceeded' }],
    ['a scrobble outside the date', page({ total: 1, newest: { at: 1_000_000_000, name: 'Old' } })],
    ['a total the page does not hold', page({ total: 5 })],
    [
      'another user',
      {
        recenttracks: {
          ...page({ total: 0 }).recenttracks,
          '@attr': { user: 'x', page: '1', perPage: '1', totalPages: '0', total: '0' },
        },
      },
    ],
  ])('writes nothing for %s', async (_, body) => {
    network.use(
      http.post(lastfmUrl, async ({ request }) => {
        const form = await request.clone().formData();
        const span = Number(form.get('to')) - Number(form.get('from'));
        return form.has('to') && span <= 25 * 3600 ? HttpResponse.json(body) : undefined;
      }),
      ...upstreamHandlers()
    );
    await pullListening('2026-10-26T09:01:00Z');
    expect(await dayCount()).toBe(0);
    expect((await sourceHealth('listening'))?.lastErrorCode).toBeNull();
  });

  // Catches a late scrobble lost once the date has ended.
  it('takes a late scrobble for yesterday the next hour', async () => {
    lastfm({ '2026-10-25': { total: 9, newest: scrobbleAt('2026-10-25T20:00:00Z', 'Early') } });
    await pullListening('2026-10-26T00:01:00Z');
    lastfm({ '2026-10-25': { total: 10, newest: scrobbleAt('2026-10-25T23:50:00Z', 'Synced') } });
    await pullListening('2026-10-26T01:01:00Z');
    expect(await listeningDay('2026-10-25')).toEqual({
      count: 10,
      last: { track: 'Synced', artist: 'LTN', playedAt: '2026-10-25T23:50:00Z' },
      asOf: '2026-10-26T01:01:00.000Z',
    });
  });

  // Catches a re-pull of a closed day replacing good data, and a write per hour for nothing.
  it('leaves a closed day alone when a read adds nothing or says less', async () => {
    const good = { total: 9, newest: scrobbleAt('2026-10-25T23:00:00Z', 'Good') };
    lastfm({ '2026-10-25': good });
    await pullListening('2026-10-26T00:01:00Z');
    const before = await row('listening', '2026-10-25');

    lastfm({ '2026-10-25': good });
    await pullListening('2026-10-26T01:01:00Z');
    lastfm({ '2026-10-25': { total: 4, newest: scrobbleAt('2026-10-25T10:00:00Z', 'Worse') } });
    await pullListening('2026-10-26T02:01:00Z');
    lastfm({});
    await pullListening('2026-10-26T03:01:00Z');

    expect(await row('listening', '2026-10-25')).toEqual(before);
  });

  // Catches a read begun before midnight dated after it: that day would pass for closed.
  it('dates a read that crossed midnight by when it began', async () => {
    network.use(
      http.post(lastfmUrl, async ({ request }) => {
        const form = await request.clone().formData();
        if (form.get('to') === null || form.get('limit') !== '1') return undefined;
        if (Number(form.get('to')) - Number(form.get('from')) > 25 * 3600) return undefined;
        vi.setSystemTime(Date.parse('2026-10-26T00:00:02Z'));
        return HttpResponse.json(page({ total: 0 }));
      }),
      ...upstreamHandlers()
    );
    await pullListening('2026-10-25T23:03:00Z');
    expect((await listeningDay('2026-10-25'))?.asOf).toBe('2026-10-25T23:03:00.000Z');
  });
});

type Recording = {
  series: string;
  lastSuccessAt: string | null;
  stale: boolean;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
  lastErrorDate: string | null;
};
const recording = async (series: string) => {
  const body = await (await fetchApi('/v1/health')).json<{ days: Recording[] }>();
  return body.days.find((day) => day.series === series);
};

describe('whether days are being recorded', () => {
  const badPage = () => {
    const body = page({ total: 0 });
    body.recenttracks['@attr'].perPage = '50';
    return body;
  };
  /** Every day range answers `body`; the snapshot's own reads stay valid. */
  const dayRanges = (body: ReturnType<typeof page>) =>
    network.use(
      http.post(lastfmUrl, async ({ request }) => {
        const form = await request.clone().formData();
        const span = Number(form.get('to')) - Number(form.get('from'));
        return form.has('to') && span <= 25 * 3600 ? HttpResponse.json(body) : undefined;
      }),
      ...upstreamHandlers()
    );

  // Catches the failure the snapshot hides: Last.fm's range metadata differing from what the
  // reader checks, hour after hour, while /v1/listening and its health stay clean.
  it('shows a lasting failure apart from the source, keeps it across good pulls, then recovers', async () => {
    dayRanges(badPage());
    await pullListening('2026-10-26T09:01:00Z');
    await pullListening('2026-10-26T09:30:00Z');
    await pullListening('2026-10-26T10:01:00Z');

    expect(await dayCount()).toBe(0);
    expect((await sourceHealth('listening'))?.lastErrorCode).toBeNull();
    expect(await recording('listening')).toEqual({
      series: 'listening',
      lastSuccessAt: null,
      stale: true,
      lastErrorCode: 'upstream_malformed',
      lastErrorAt: '2026-10-26T10:01:00.000Z',
      lastErrorDate: '2026-10-25',
    });

    lastfm({ '2026-10-26': { total: 2, newest: scrobbleAt('2026-10-26T08:00:00Z', 'Back') } });
    await pullListening('2026-10-26T11:01:00Z');
    expect(await recording('listening')).toMatchObject({
      lastSuccessAt: '2026-10-26T11:01:00.000Z',
      stale: false,
      lastErrorCode: null,
      lastErrorDate: null,
    });
    expect((await listeningDay('2026-10-26'))?.count).toBe(2);
  });

  // Catches a half-failed pull reported as a success because one of its dates recorded.
  it('reports the date that failed when the other recorded, and keeps the last success', async () => {
    lastfm({});
    await pullListening('2026-10-26T09:01:00Z');
    lastfm({ '2026-10-25': null });
    await pullListening('2026-10-26T10:01:00Z');
    expect(await recording('listening')).toMatchObject({
      lastSuccessAt: '2026-10-26T09:01:00.000Z',
      lastErrorCode: 'upstream_unreachable',
      lastErrorDate: '2026-10-25',
    });
  });

  // Catches a reading refused as impossible passing for a recording weather series.
  it('shows a weather reading refused for its date, and recovers', async () => {
    await pullWeather('2026-11-06T12:00:00Z', {
      code: 61,
      isDay: 1,
      observedAt: '2026-11-08T13:00:00Z',
    });
    expect(await recording('weather')).toMatchObject({
      lastErrorCode: 'upstream_future',
      lastErrorDate: '2026-11-08',
    });
    await pullWeather('2026-11-06T12:15:00Z', { code: 2, isDay: 1 });
    expect(await recording('weather')).toMatchObject({
      lastSuccessAt: '2026-11-06T12:15:00.000Z',
      lastErrorCode: null,
    });
  });

  // Catches a success recorded for days that were never written: its fence lost to a backfill.
  it('claims no success for a pull whose write was refused', async () => {
    await seedSnapshots();
    const store = new D1SnapshotStore(env.DB);
    const batch = env.DB.batch.bind(env.DB);
    let landed: Promise<boolean> | undefined;
    const db = Object.create(env.DB, {
      batch: {
        value: async (statements: D1PreparedStatement[]) => {
          await landed;
          return batch(statements);
        },
      },
    }) as D1Database;
    const day = '2026-10-26';
    const json = JSON.stringify({ count: 1, last: null, asOf: '2026-11-06T09:00:00.000Z' });
    await new D1SnapshotStore(db).putDated(
      'listening',
      {
        fetchedAt: '2026-11-06T09:30:00.000Z',
        dates: { from: day, to: day },
        outcome: { date: day, code: null },
        merge: () => {
          landed = store.mergeDays(
            'listening',
            day,
            () => [{ day, json }],
            '2026-11-06T09:31:00.000Z'
          );
          return { snapshot: {}, days: [{ day, json }] };
        },
      },
      '2026-11-06T09:30:00.000Z'
    );
    expect((await recording('listening'))?.lastSuccessAt).toBeNull();
  });
});

describe('the listening merge', () => {
  const stored: ListeningStoredDay = {
    count: 5,
    last: { track: 'A', artist: 'X', playedAt: '2026-10-25T20:00:00Z' },
    asOf: '2026-10-25T21:00:00.000Z',
  };

  // Catches last-track order taken from arrival: an older answer that came late wins.
  it('orders the last track by when it was played, whatever arrives after', () => {
    const older = {
      count: 6,
      last: { track: 'Earlier', artist: 'X', playedAt: '2026-10-25T10:00:00Z' },
      asOf: '2026-10-25T22:00:00.000Z',
    };
    expect(mergeListeningDay('2026-10-25', stored, older)).toEqual({
      ...older,
      last: stored.last,
    });
  });

  // Catches equal counts refusing a later track: a scrobble deleted and another played.
  it('admits a later track at an equal count, and a correction at the same instant', () => {
    const later = {
      count: 5,
      last: { track: 'B', artist: 'X', playedAt: '2026-10-25T20:30:00Z' },
      asOf: '2026-10-25T22:00:00.000Z',
    };
    expect(mergeListeningDay('2026-10-25', stored, later)).toEqual(later);
    const corrected = {
      ...later,
      last: { ...stored.last, track: 'A (fixed)' },
    } as ListeningStoredDay;
    expect(mergeListeningDay('2026-10-25', stored, corrected).last?.track).toBe('A (fixed)');
  });
});

describe('the weather pull', () => {
  // Catches a slot keyed on the wrong clock, and the snapshot losing what the room reads.
  it('keeps a code for the day and one for the night, and the snapshot as it was', async () => {
    await pullWeather('2026-10-26T12:30:00Z', { code: 61, isDay: 1 });
    await pullWeather('2026-10-26T21:30:00Z', { code: 0, isDay: 0 });

    const response = await fetchApi('/v1/days/weather?month=2026-10');
    const body = weatherDaysEnvelopeSchema.parse(await response.json());
    expect(body.data?.days).toEqual([
      {
        date: '2026-10-26',
        day: { code: 61, at: '2026-10-26T12:30:00Z', origin: 'live' },
        night: { code: 0, at: '2026-10-26T21:30:00Z', origin: 'live' },
      },
    ]);
    const live = weatherEnvelopeSchema.parse(await (await fetchApi('/v1/weather')).json());
    expect(live.data?.observedAt).toBe('2026-10-26T21:30:00Z');
  });

  // Catches the last reading of a date standing for all of it, whatever the hour.
  it('keeps the reading nearest 13:00 and 22:00', async () => {
    await pullWeather('2026-10-26T12:45:00Z', { code: 2, isDay: 1 });
    await pullWeather('2026-10-26T13:00:00Z', { code: 3, isDay: 1 });
    await pullWeather('2026-10-26T13:15:00Z', { code: 61, isDay: 1 });
    expect((await weatherDay('2026-10-26'))?.day).toEqual({
      code: 3,
      at: '2026-10-26T13:00:00Z',
      origin: 'live',
    });
  });

  // Catches an unknown code erasing a known one, which the room would draw as no weather.
  it('keeps a known code over an unknown one nearer the aim, and an unknown one over nothing', async () => {
    await pullWeather('2026-10-26T09:00:00Z', { code: 199, isDay: 1 });
    expect((await weatherDay('2026-10-26'))?.day?.code).toBe(199);
    await pullWeather('2026-10-26T10:00:00Z', { code: 2, isDay: 1 });
    await pullWeather('2026-10-26T13:00:00Z', { code: 199, isDay: 1 });
    expect((await weatherDay('2026-10-26'))?.day).toEqual({
      code: 2,
      at: '2026-10-26T10:00:00Z',
      origin: 'live',
    });
  });

  // Catches a null `is_day` read as night, or a row of two empty slots that claims a record.
  it('writes no day when Open-Meteo does not say whether the sun is up', async () => {
    await pullWeather('2026-10-26T12:30:00Z', { code: 2, isDay: null });
    expect(await dayCount()).toBe(0);
    expect((await snapshotRow('weather'))?.json).toContain('"weatherCode":2');
  });

  // Catches the date taken from UTC: 23:30 UTC at +01 is already the next date in Rabat.
  it('files a reading under its date in Rabat', async () => {
    await pullWeather('2026-09-19T23:30:00Z', { code: 0, isDay: 0 });
    expect(await weatherDay('2026-09-19')).toBeUndefined();
    expect((await weatherDay('2026-09-20'))?.night?.code).toBe(0);
  });

  // Catches a reading dated ahead of the clock taking its slot's exact aim: no real reading
  // could beat it, and the archive may not replace a live slot, so it would stay for good.
  it('never records a reading from the future, and that date fills as usual', async () => {
    await pullWeather('2026-11-06T12:00:00Z', {
      code: 61,
      isDay: 1,
      observedAt: '2026-11-08T13:00:00Z',
    });
    expect(await dayCount()).toBe(0);
    expect((await snapshotRow('weather'))?.json).toContain('"weatherCode":61');

    await pullWeather('2026-11-08T12:45:00Z', { code: 2, isDay: 1 });
    expect((await weatherDay('2026-11-08'))?.day).toEqual({
      code: 2,
      at: '2026-11-08T12:45:00Z',
      origin: 'live',
    });
  });

  // Catches the limit set tighter than the runner's: an ordinary step just ahead of the clock.
  it('takes a reading a moment ahead of the clock', async () => {
    await pullWeather('2026-10-26T12:30:00Z', {
      code: 2,
      isDay: 1,
      observedAt: '2026-10-26T12:34:00Z',
    });
    expect((await weatherDay('2026-10-26'))?.day?.at).toBe('2026-10-26T12:34:00Z');
  });

  // Catches a failed pull writing a day, or taking the stored one with it.
  it('writes nothing on a failed pull', async () => {
    await pullWeather('2026-10-26T12:30:00Z', { code: 61, isDay: 1 });
    const before = await row('weather', '2026-10-26');
    const now = at('2026-10-26T12:45:00Z');
    network.use(...upstreamHandlers({ openMeteo: 'malformed' }));
    await runScheduled(env, [weather], now);
    expect(await row('weather', '2026-10-26')).toEqual(before);
    expect((await sourceHealth('weather'))?.lastErrorCode).toBe('upstream_malformed');
  });
});

describe('the archive', () => {
  // Catches a change in the wire format, on a real answer: 2026-11-04 was at +00.
  it('reads the hours nearest the slots from a real answer', () => {
    const { ok } = rawFixtures['open-meteo-archive'];
    expect(weatherDayOf('2026-11-04', ok)).toEqual({
      day: { code: 2, at: '2026-11-04T13:00:00Z', origin: 'archive' },
      night: { code: 1, at: '2026-11-04T22:00:00Z', origin: 'archive' },
    });
  });

  // Catches an hour the models have not reached read as code 0, clear sky.
  it('leaves a slot empty when the hour has no code', () => {
    const body = archive('2026-11-04', (hour) => (hour < 20 ? 3 : null));
    expect(weatherDayOf('2026-11-04', { status: 200, body })).toEqual({
      day: { code: 3, at: '2026-11-04T13:00:00Z', origin: 'archive' },
      night: null,
    });
  });

  // Catches hours read by position: at +01 the day starts at 23:00 UTC the day before.
  it('picks the hour by instant at +01', () => {
    const body = archive('2026-08-10', (hour) => hour);
    expect(weatherDayOf('2026-08-10', { status: 200, body })).toEqual({
      day: { code: 12, at: '2026-08-10T12:00:00Z', origin: 'archive' },
      night: { code: 21, at: '2026-08-10T21:00:00Z', origin: 'archive' },
    });
  });

  // Catches reanalysis from another grid cell replacing what the room actually showed.
  it('fills what was missed and never replaces a live slot', () => {
    const live = { code: 61, at: '2026-10-26T09:00:00Z', origin: 'live' } as const;
    const near = { code: 0, at: '2026-10-26T13:00:00Z', origin: 'archive' } as const;
    const night = { code: 1, at: '2026-10-26T22:00:00Z', origin: 'archive' } as const;
    expect(mergeWeatherDay('2026-10-26', { day: live, night: null }, { day: near, night })).toEqual(
      { day: live, night }
    );
  });
});

/** Arms a backfill the way `just signals-backfill` does. */
const arm = (from: string, to: string) =>
  env.DB.prepare(
    `INSERT INTO pull_progress (source, described_date, step, json)
     VALUES ('daily-backfill', ?2, 1, json_object('next', ?1, 'to', ?2, 'tries', 0))
     ON CONFLICT (source) DO UPDATE SET
       described_date = excluded.described_date, step = step + 1, json = excluded.json`
  )
    .bind(from, to)
    .run();

const backfillState = async () => {
  const found = await env.DB.prepare(
    "SELECT json FROM pull_progress WHERE source = 'daily-backfill'"
  ).first<{ json: string }>();
  return found === null ? undefined : JSON.parse(found.json);
};

/** The live snapshots a backfill must not touch, without the fence it may move. */
const liveRows = async () =>
  (
    await env.DB.prepare(
      'SELECT source, json, fetched_at, last_success_at, last_attempt_at, last_error_code FROM snapshots ORDER BY source'
    ).all()
  ).results;

const seedSnapshots = async () => {
  const store = new D1SnapshotStore(env.DB);
  await store.put('listening', snapshotFixtures.listening.ok, '2026-11-06T09:00:00.000Z');
  await store.put('weather', snapshotFixtures.weather.ok, '2026-11-06T09:00:00.000Z');
};

/** One cron run with no adapter due at `time`: only the backfill has anything to do. */
const tick = (time: string) => runScheduled(withKey, [], at(time));

describe('the backfill', () => {
  const quiet = (_date: string, hour: number) => (hour === 13 ? 3 : 1);

  // Catches an old day dated into the snapshot: /v1/listening would serve history as now, or
  // the freshness of an outage would be hidden.
  it('fills one date per run, then finishes, and leaves the snapshots as they were', async () => {
    await seedSnapshots();
    const before = await liveRows();
    await arm('2026-10-01', '2026-10-02');
    const seen = lastfm({
      '2026-10-01': { total: 7, newest: scrobbleAt('2026-10-01T20:00:00Z', 'Old') },
    });
    const asked = archiveAnswers(quiet);

    await tick('2026-11-06T10:00:30Z');
    expect(await listeningDay('2026-10-01')).toEqual({
      count: 7,
      last: { track: 'Old', artist: 'LTN', playedAt: '2026-10-01T20:00:00Z' },
      asOf: '2026-11-06T10:00:30.000Z',
    });
    expect(await listeningDay('2026-10-02')).toBeUndefined();
    expect(seen.requests + asked.requests).toBe(2);

    await tick('2026-11-06T10:01:30Z');
    expect((await weatherDay('2026-10-02'))?.day?.origin).toBe('archive');
    expect(await listeningDay('2026-10-02')).toMatchObject({ count: 0, last: null });
    expect(await backfillState()).toBeNull();

    await tick('2026-11-06T10:02:30Z');
    expect(seen.requests + asked.requests).toBe(4);
    expect(await liveRows()).toEqual(before);
  });

  // Catches a kill between the two series losing the date, or counting it twice.
  it('repeats a date after a run cut off between its two commits', async () => {
    await seedSnapshots();
    await arm('2026-10-01', '2026-10-01');
    lastfm({ '2026-10-01': { total: 7, newest: scrobbleAt('2026-10-01T20:00:00Z', 'Old') } });
    archiveAnswers(quiet);
    await env.DB.exec(
      "CREATE TRIGGER cut BEFORE INSERT ON daily WHEN NEW.source = 'weather' BEGIN SELECT RAISE(ABORT, 'cut'); END"
    );
    await tick('2026-11-06T10:00:30Z');
    await env.DB.exec('DROP TRIGGER cut');
    expect((await listeningDay('2026-10-01'))?.count).toBe(7);
    expect(await weatherDay('2026-10-01')).toBeUndefined();
    expect(await backfillState()).toMatchObject({ next: '2026-10-01', tries: 1 });

    await tick('2026-11-06T10:01:30Z');
    expect((await listeningDay('2026-10-01'))?.count).toBe(7);
    expect((await weatherDay('2026-10-01'))?.day?.code).toBe(3);
    expect(await backfillState()).toBeNull();
  });

  // Catches a backfill that asks every minute for ever while an upstream is down.
  it('stops after five failed runs on a date, keeps where it stopped, and asks no more', async () => {
    await seedSnapshots();
    await arm('2026-10-01', '2026-10-03');
    const seen = lastfm({ '2026-10-01': null });
    archiveAnswers(quiet);
    for (let minute = 0; minute < 8; minute++) {
      await tick(`2026-11-06T10:0${minute}:30Z`);
    }
    expect(seen.asked.length).toBe(5);
    expect(await backfillState()).toEqual({
      next: '2026-10-01',
      to: '2026-10-03',
      tries: 5,
      stopped: true,
    });
    expect(await dayCount()).toBe(0);
  });

  // Catches a date committed for one series when the other's read failed.
  it('commits nothing of a date when the archive refuses', async () => {
    await seedSnapshots();
    await arm('2026-10-01', '2026-10-01');
    lastfm({ '2026-10-01': { total: 7, newest: scrobbleAt('2026-10-01T20:00:00Z', 'Old') } });
    network.use(http.get(archiveUrl, () => new HttpResponse(null, { status: 429 })));
    await tick('2026-11-06T10:00:30Z');
    expect(await dayCount()).toBe(0);
  });

  // Catches an unbounded or mistyped arming: a range ending today, or reversed, or over a year.
  it.each([
    ['ends today', '2026-11-01', '2026-11-06'],
    ['runs backwards', '2026-10-05', '2026-10-01'],
    ['spans over 400 days', '2025-01-01', '2026-10-01'],
    ['is not a date', '2026-02-30', '2026-10-01'],
  ])('refuses a range that %s, and asks nothing', async (_, from, to) => {
    await seedSnapshots();
    await arm(from, to);
    const seen = lastfm({});
    await tick('2026-11-06T10:00:30Z');
    expect(seen.requests).toBe(0);
    expect(await backfillState()).toBeNull();
  });

  const date = '2026-10-26';
  const json = (count: number) =>
    JSON.stringify({ count, last: null, asOf: '2026-11-06T09:00:00.000Z' });
  const backfilled = (store: D1SnapshotStore, count: number) =>
    store.mergeDays(
      'listening',
      date,
      () => [{ day: date, json: json(count) }],
      '2026-11-06T09:31:00.000Z'
    );
  const live = (during: () => void = () => {}, count = 1) => ({
    fetchedAt: '2026-11-06T09:30:00.000Z',
    dates: { from: date, to: date },
    merge: () => {
      during();
      return { snapshot: { from: 'live' }, days: [{ day: date, json: json(count) }] };
    },
  });

  // Catches a live pull writing a merge it read before a backfill landed: the backfilled
  // count would be lost. The stand-in lands the backfill while the pull is between its batches.
  it('drops a live pull that read before a backfill landed, snapshot and day', async () => {
    await seedSnapshots();
    const store = new D1SnapshotStore(env.DB);
    const before = (await snapshotRow('listening'))?.json;
    let landed: Promise<boolean> | undefined;
    const pull = live(() => {
      landed = backfilled(store, 9);
    });
    // The pull's write waits for the backfill, as a slower isolate's would.
    const batch = env.DB.batch.bind(env.DB);
    const db = Object.create(env.DB, {
      batch: {
        value: async (statements: D1PreparedStatement[]) => {
          await landed;
          return batch(statements);
        },
      },
    }) as D1Database;
    await new D1SnapshotStore(db).putDated('listening', pull, '2026-11-06T09:30:00.000Z');

    expect(await landed).toBe(true);
    expect((await listeningDay(date))?.count).toBe(9);
    expect((await snapshotRow('listening'))?.json).toBe(before);
  });

  // Catches the reverse: a backfill writing a merge it read before a live pull landed.
  it('drops a backfill that read before a live pull landed', async () => {
    await seedSnapshots();
    const store = new D1SnapshotStore(env.DB);
    const won = await store.mergeDays(
      'listening',
      date,
      () => [{ day: date, json: json(2) }],
      '2026-11-06T09:31:00.000Z'
    );
    expect(won).toBe(true);

    const batch = env.DB.batch.bind(env.DB);
    let pulled: Promise<void> | undefined;
    const db = Object.create(env.DB, {
      batch: {
        value: async (statements: D1PreparedStatement[]) => {
          await pulled;
          return batch(statements);
        },
      },
    }) as D1Database;
    const lost = await new D1SnapshotStore(db).mergeDays(
      'listening',
      date,
      () => {
        pulled = store.putDated('listening', live(undefined, 7), '2026-11-06T09:30:00.000Z');
        return [{ day: date, json: json(3) }];
      },
      '2026-11-06T09:31:00.000Z'
    );

    expect(lost).toBe(false);
    expect((await listeningDay(date))?.count).toBe(7);
  });
});

describe('a Worker from before this change on the same D1', () => {
  // Catches a plain `put`, all the older version has, breaking the fence for the new one.
  it('can store its snapshots between new writes, and the new ones still land', async () => {
    await pullWeather('2026-10-26T12:30:00Z', { code: 61, isDay: 1 });
    await new D1SnapshotStore(env.DB).put(
      'weather',
      snapshotFixtures.weather.ok,
      '2026-10-26T12:40:00.000Z'
    );
    await pullWeather('2026-10-26T13:00:00Z', { code: 2, isDay: 1 });
    expect((await weatherDay('2026-10-26'))?.day?.code).toBe(2);
  });

  // Catches new rows showing up in the series an older reader knows.
  it('reads its own series unchanged with the new rows in the table', async () => {
    lastfm({ '2026-10-26': { total: 2, newest: scrobbleAt('2026-10-26T08:00:00Z', 'A') } });
    await pullListening('2026-10-26T09:01:00Z');
    await pullWeather('2026-10-26T12:30:00Z', { code: 61, isDay: 1 });
    await new D1SnapshotStore(env.DB).put(
      'llm-usage',
      snapshotFixtures['llm-usage'].ok,
      '2026-10-26T12:40:00.000Z'
    );

    const response = await fetchApi('/v1/days/llm-usage?month=2026-10');
    expect(llmUsageDaysEnvelopeSchema.parse(await response.json()).data?.days).toEqual([]);
    const live = await fetchApi('/v1/listening');
    expect(listeningEnvelopeSchema.parse(await live.json()).data as ListeningSnapshot).toEqual(
      snapshotFixtures.listening.ok
    );
  });
});

describe('days over generated sequences', () => {
  /** A seeded generator, so a failing sequence can be replayed. */
  const random = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const date = '2026-10-25';
  const start = Date.parse('2026-10-25T00:00:00Z');
  const hour = 3_600_000;

  // Catches any order of reads, failures, restarts and backfills lowering a day: every merge
  // rule at once. A restart is a run with no memory, which is all these are.
  it.each([1, 2, 3, 4])('never loses listening, for seed %i', { timeout: 60_000 }, async (seed) => {
    const next = random(seed);
    await seedSnapshots();
    let best = { count: 0, playedAt: 0, asOf: 0 };
    for (let step = 0; step < 40; step++) {
      const roll = next();
      const read = start + Math.floor(next() * 40) * hour;
      const played = start + Math.floor(next() * 24) * hour;
      const answer =
        roll < 0.15
          ? null
          : roll < 0.3
            ? { total: 0 }
            : {
                total: 1 + Math.floor(next() * 30),
                newest: { at: played / 1000, name: `T${Math.floor(next() * 5)}` },
              };
      lastfm({ [date]: answer, '2026-10-26': { total: 0 } });
      const time = new Date(Math.floor(read / hour) * hour + 60_000).toISOString();
      if (next() < 0.7 && read >= start && read < start + 48 * hour) {
        await pullListening(time);
      } else {
        archiveAnswers(() => (next() < 0.5 ? null : 3));
        await arm(date, date);
        await tick('2026-11-06T10:00:30Z');
      }

      const stored = await listeningDay(date);
      if (stored === undefined) continue;
      const now = {
        count: stored.count,
        playedAt: stored.last === null ? 0 : Date.parse(stored.last.playedAt),
        asOf: Date.parse(stored.asOf),
      };
      expect(now.count, `step ${step}`).toBeGreaterThanOrEqual(best.count);
      expect(now.playedAt, `step ${step}`).toBeGreaterThanOrEqual(best.playedAt);
      expect(
        stored.last === null ? stored.count === 0 || best.playedAt === 0 : stored.count > 0
      ).toBe(true);
      best = now;
    }
  });

  // Catches a slot emptied, turned unknown, moved off a live reading or further from its aim.
  it.each([1, 2, 3, 4])('never worsens a weather slot, for seed %i', (seed) => {
    const next = random(seed);
    const aim = Date.parse('2026-10-25T13:00:00Z');
    const codes = [0, 3, 61, 199, 777];
    const known = (code: number) => code < 100;
    let day: WeatherStoredDay = { day: null, night: null };
    for (let step = 0; step < 300; step++) {
      const reading =
        next() < 0.2
          ? null
          : {
              code: codes[Math.floor(next() * codes.length)] ?? 0,
              at: new Date(aim + Math.floor(next() * 20 - 10) * hour)
                .toISOString()
                .replace('.000', ''),
              origin: next() < 0.5 ? ('live' as const) : ('archive' as const),
            };
      const before = day.day;
      day = mergeWeatherDay(date, day, { day: reading, night: null });
      if (before === null) continue;
      const after = day.day;
      expect(after).not.toBeNull();
      if (after === null) continue;
      expect(known(after.code) || !known(before.code), `step ${step}`).toBe(true);
      if (known(after.code) === known(before.code)) {
        expect(after.origin === 'live' || before.origin === 'archive', `step ${step}`).toBe(true);
        if (after.origin === before.origin) {
          expect(Math.abs(Date.parse(after.at) - aim)).toBeLessThanOrEqual(
            Math.abs(Date.parse(before.at) - aim)
          );
        }
      }
    }
  });
});
