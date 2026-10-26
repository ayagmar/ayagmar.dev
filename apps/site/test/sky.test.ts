import { describe, expect, it } from 'vitest';
import { isLate, moonAt, moonPath, rabatTime, skyAt } from '../src/lib/sky.ts';

const hour = 3_600_000;
const minute = 60_000;

describe('the moon', () => {
  // Illuminated fraction in percent, from NASA SVS Dial-A-Moon (JPL DE ephemeris),
  // https://svs.gsfc.nasa.gov/api/dialamoon/<time>, fetched 2026-10-26. Its 2027 tables are not
  // published yet; the named phases below cover 2027.
  it.each([
    ['2026-01-05T12:00Z', 94.08],
    ['2026-02-20T00:00Z', 7.27],
    ['2026-03-28T06:00Z', 76.14],
    ['2026-04-21T18:00Z', 24.4],
    ['2026-05-30T00:00Z', 98.14],
    ['2026-06-12T00:00Z', 14.27],
    ['2026-07-02T12:00Z', 94.29],
    ['2026-08-15T00:00Z', 6.63],
    ['2026-09-22T06:00Z', 80.29],
    ['2026-10-26T00:00Z', 99.81],
    ['2026-11-20T12:00Z', 78.88],
    ['2026-12-28T00:00Z', 78.89],
  ])('at %s is %f%% lit, within 3 points', (time, percent) => {
    expect(Math.abs(moonAt(Date.parse(time)).fraction * 100 - percent)).toBeLessThan(3);
  });

  // Instants (UT) from Espenak, "Six Millennium Catalog of Phases of the Moon", NASA GSFC,
  // https://eclipse.gsfc.nasa.gov/phase/phases2001.html. The moon moves about 12.19° from the
  // sun per day, so "within one day" is an elongation within 12.19° of the phase's.
  it.each([
    ['2026-01-03T10:03Z', 'full moon', 180],
    ['2026-03-19T01:23Z', 'new moon', 0],
    ['2026-05-23T11:11Z', 'first quarter moon', 90],
    ['2026-08-06T02:21Z', 'last quarter moon', 270],
    ['2026-10-26T04:12Z', 'full moon', 180],
    ['2027-01-07T20:24Z', 'new moon', 0],
    ['2027-02-14T07:58Z', 'first quarter moon', 90],
    ['2027-04-28T20:18Z', 'last quarter moon', 270],
    ['2027-06-19T00:44Z', 'full moon', 180],
    ['2027-09-07T18:31Z', 'first quarter moon', 90],
    ['2027-11-28T03:24Z', 'new moon', 0],
    ['2027-12-20T09:11Z', 'last quarter moon', 270],
  ])('at %s is a %s, within one day', (time, name, elongation) => {
    const moon = moonAt(Date.parse(time));
    expect(moon.name).toBe(name);
    expect(Math.abs(((moon.elongation - elongation + 540) % 360) - 180)).toBeLessThan(12.19);
  });

  // Catches a moon lit on the wrong side: from Morocco a waxing moon is lit on the right.
  it('is drawn lit on the right while waxing and on the left while waning', () => {
    const columns = (path: string) => [...path.matchAll(/M(-?\d+) /g)].map(([, x]) => Number(x));
    const waxing = moonPath(moonAt(Date.parse('2026-02-20T00:00Z')), 0, 0, 6);
    const waning = moonPath(moonAt(Date.parse('2026-06-12T00:00Z')), 0, 0, 6);
    expect(Math.min(...columns(waxing))).toBeGreaterThanOrEqual(0);
    expect(Math.max(...columns(waning))).toBeLessThan(0);
    expect(moonPath({ elongation: 0, fraction: 0, waxing: true, name: 'new moon' }, 0, 0, 6)).toBe(
      ''
    );
  });
});

/** Local Rabat times at which the sky turns to and from day, minute by minute. */
function sunriseAndSunset(day: string): string[] {
  const changes: string[] = [];
  const start = Date.parse(`${day}T00:00Z`);
  for (let time = start; time < start + 24 * hour; time += 15_000) {
    if ((skyAt(time) === 'day') !== (skyAt(time - 15_000) === 'day')) {
      changes.push(rabatTime(time));
    }
  }
  return changes;
}

const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));

describe('the sun', () => {
  // Sunrise and sunset in Rabat local time from the NOAA Solar Calculator's own code
  // (https://gml.noaa.gov/grad/solcalc/main.js, calcSunriseSet, fetched 2026-10-26) at Hassan Tower,
  // 34.0240 N, 6.8228 W, with the offset tzdata gives that day. Morocco's clock changes in 2026 (tzdata
  // 2026c, the `africa` file): +01 to +00 on 15 Feb for Ramadan, back to +01 on 22 Mar, and to
  // +00 for good on 20 Sep. There are no changes in 2027, so these dates sit on both sides of the
  // 2026 ones. A fixed +01 offset fails every date at +00.
  it.each([
    ['2026-02-14', '08:13', '19:10'], // +01
    ['2026-02-15', '07:12', '18:11'], // +00
    ['2026-03-21', '06:30', '18:40'], // +00
    ['2026-03-22', '07:28', '19:40'], // +01
    ['2026-09-19', '07:13', '19:28'], // +01
    ['2026-09-20', '06:14', '18:27'], // +00
    ['2026-12-21', '07:29', '17:22'], // +00
    ['2027-06-21', '05:16', '19:42'], // +00
  ])('on %s rises at %s and sets at %s, within 2 minutes', (day, rise, set) => {
    const [up, down, ...rest] = sunriseAndSunset(day);
    expect(rest).toEqual([]);
    expect(Math.abs(minutes(up ?? '') - minutes(rise))).toBeLessThanOrEqual(2);
    expect(Math.abs(minutes(down ?? '') - minutes(set))).toBeLessThanOrEqual(2);
  });

  it('gives dusk between day and night', () => {
    const skies: string[] = [];
    for (
      let time = Date.parse('2026-10-26T17:30Z');
      time < Date.parse('2026-10-26T19:30Z');
      time += minute
    ) {
      const sky = skyAt(time);
      if (skies.at(-1) !== sky) skies.push(sky);
    }
    expect(skies).toEqual(['day', 'dusk', 'night']);
  });
});

describe('the lamp', () => {
  // The reference: the hour in Rabat read with Intl alone, another way than rabatTime.
  const reference = (time: number) => {
    const hour = new Date(time).toLocaleString('en-US', {
      timeZone: 'Africa/Casablanca',
      hour: 'numeric',
      hourCycle: 'h23',
    });
    return Number(hour) >= 2 && Number(hour) < 7;
  };

  /** The instant of a Rabat wall-clock time, trying both offsets Morocco has used. */
  const local = (day: string, clock: string) =>
    [0, 1]
      .map((offset) => Date.parse(`${day}T${clock}:00Z`) - offset * hour)
      .find((time) => rabatTime(time) === clock) ?? Number.NaN;

  // A fixed seed: the same instants on every run.
  let seed = 0x2027;
  const next = () => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return seed / 2 ** 32;
  };

  const transitions = ['2026-02-15T02:00Z', '2026-03-22T02:00Z', '2026-09-20T01:00Z'].map(
    Date.parse
  );
  // 2026-03-22 is left out: its 02:00 to 02:59 never happened, the clocks jumped to 03:00.
  const days = [
    '2026-02-14',
    '2026-02-15',
    '2026-03-21',
    '2026-03-23',
    '2026-09-19',
    '2026-09-20',
    '2027-03-01',
  ];
  const instants = [
    // Both sides of each clock change, a minute to three hours away.
    ...transitions.flatMap((time) =>
      [1, 59, 60, 61, 119, 120, 121, 180].flatMap((offset) => [
        time - offset * minute,
        time + offset * minute,
      ])
    ),
    // The edges of the window, on days at either offset.
    ...days.flatMap((day) =>
      ['01:59', '02:00', '06:59', '07:00'].map((clock) => local(day, clock))
    ),
    // And anywhere in 2026 and 2027.
    ...Array.from(
      { length: 2000 },
      () => Date.parse('2026-01-01T00:00Z') + Math.floor(next() * 2 * 365 * 24 * 60) * minute
    ),
  ];

  it('agrees with an Intl reference at every generated instant', () => {
    expect(instants.every(Number.isFinite)).toBe(true);
    expect(instants.filter((time) => isLate(time) !== reference(time))).toEqual([]);
  });

  it('is turned down from 02:00 up to 07:00 local time, on either offset', () => {
    for (const day of days) {
      expect(
        ['01:59', '02:00', '06:59', '07:00'].map((clock) => isLate(local(day, clock)))
      ).toEqual([false, true, true, false]);
    }
  });
});
