/**
 * The room's clock (ADR 0027): the sky over Rabat, the moon's phase and the local time,
 * for any instant. Pure functions of a time in milliseconds; the home page script
 * (src/scripts/room.ts) and the tests share them.
 *
 * Sun: the NOAA solar position equations (the NOAA Solar Calculator's own code,
 * https://gml.noaa.gov/grad/solcalc/main.js, after Meeus, Astronomical Algorithms).
 * Moon: Meeus, Astronomical Algorithms, 2nd ed. (1998), the arguments D, M and M' of chapter
 * 47 and the phase angle of chapter 48 (48.4). Local time: Intl with IANA tzdata, never a fixed
 * offset, since Morocco's offset has changed with Ramadan and, in 2026, by decree.
 */

// Hassan Tower, Rabat. Africa/Casablanca is the IANA zone for all of Morocco.
const rabat = { lat: 34.024, lon: -6.8228, timeZone: 'Africa/Casablanca' } as const;

const rad = Math.PI / 180;
const sin = (deg: number) => Math.sin(deg * rad);
const cos = (deg: number) => Math.cos(deg * rad);
const dayMs = 86_400_000;

/** Julian centuries since J2000.0 (UT; the difference from TT is about a minute). */
const centuries = (time: number) => (time / dayMs + 2440587.5 - 2451545) / 36525;

/**
 * The sun's geometric elevation over Rabat in degrees, without refraction. The terms in
 * t² and t³ of NOAA's series are left out: this century they move the sun by under 0.0001°.
 */
function sunElevation(time: number): number {
  const t = centuries(time);
  const l0 = 280.46646 + 36000.76983 * t;
  const m = 357.52911 + 35999.05029 * t;
  const e = 0.016708634 - 0.000042037 * t;
  const center =
    sin(m) * (1.914602 - 0.004817 * t) +
    sin(2 * m) * (0.019993 - 0.000101 * t) +
    sin(3 * m) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const lambda = l0 + center - 0.00569 - 0.00478 * sin(omega);
  const obliquity = 23.439291 - 0.0130042 * t + 0.00256 * cos(omega);
  const declination = Math.asin(sin(obliquity) * sin(lambda)) / rad;
  const y = Math.tan((obliquity / 2) * rad) ** 2;
  const equationOfTime =
    (4 / rad) *
    (y * sin(2 * l0) -
      2 * e * sin(m) +
      4 * e * y * sin(m) * cos(2 * l0) -
      0.5 * y * y * sin(4 * l0) -
      1.25 * e * e * sin(2 * m));
  const minutes = (((time % dayMs) + dayMs) % dayMs) / 60_000;
  const hourAngle = (minutes + equationOfTime + 4 * rabat.lon) / 4 - 180;
  const cosZenith =
    sin(rabat.lat) * sin(declination) + cos(rabat.lat) * cos(declination) * cos(hourAngle);
  return 90 - Math.acos(Math.min(1, Math.max(-1, cosZenith))) / rad;
}

export type Sky = 'day' | 'dusk' | 'night';

/**
 * Day from sunrise to sunset (the sun's centre 0.833° below the horizon, NOAA's definition),
 * dusk during civil twilight (down to 6° below), night after that. Dawn shows the dusk sky.
 */
export function skyAt(time: number): Sky {
  const elevation = sunElevation(time);
  return elevation > -0.833 ? 'day' : elevation > -6 ? 'dusk' : 'night';
}

export interface Moon {
  /** Elongation from the sun, 0 to 360 degrees: 0 new, 90 first quarter, 180 full, 270 last. */
  elongation: number;
  /** The illuminated fraction of the disc, 0 to 1. */
  fraction: number;
  waxing: boolean;
  /** `waxing gibbous moon`; a named phase only within half a day of its instant. */
  name: string;
}

const names = [
  'new',
  'waxing crescent',
  'first quarter',
  'waxing gibbous',
  'full',
  'waning gibbous',
  'last quarter',
  'waning crescent',
];

/**
 * The moon's phase at `time`, within half a degree (under an hour). The t² terms of the
 * arguments are left out: this century they are under 0.0001°.
 */
export function moonAt(time: number): Moon {
  const t = centuries(time);
  const d = 297.8501921 + 445267.1114034 * t;
  const m = 357.5291092 + 35999.0502909 * t;
  const mp = 134.9633964 + 477198.8675055 * t;
  // 180° minus the phase angle i of Meeus (48.4).
  const raw =
    d +
    6.289 * sin(mp) -
    2.1 * sin(m) +
    1.274 * sin(2 * d - mp) +
    0.658 * sin(2 * d) +
    0.214 * sin(2 * mp) +
    0.11 * sin(d);
  const elongation = ((raw % 360) + 360) % 360;
  // A named phase within half a day (about 6°) of its exact instant, the in-between names
  // otherwise.
  const named = Math.round(elongation / 90) % 4;
  const near = Math.abs(elongation - Math.round(elongation / 90) * 90) < 6.1;
  return {
    elongation,
    fraction: (1 - cos(elongation)) / 2,
    waxing: elongation < 180,
    name: `${names[near ? named * 2 : Math.floor(elongation / 90) * 2 + 1]} moon`,
  };
}

/**
 * The lit part of a pixel moon of radius `r` centred on (`x`, `y`), as an SVG path of unit
 * squares, run by run. Seen from the northern hemisphere: a waxing moon is lit on the right.
 */
export function moonPath(moon: Moon, x: number, y: number, r: number): string {
  let path = '';
  for (let row = -r; row < r; row++) {
    const half = Math.sqrt(r * r - (row + 0.5) ** 2);
    const edge = (1 - 2 * moon.fraction) * half;
    const [from, to] = moon.waxing ? [edge, half] : [-half, -edge];
    const start = Math.ceil(from - 0.5);
    const end = Math.floor(to - 0.5);
    if (end >= start) path += `M${x + start} ${y + row}h${end - start + 1}v1h${start - end - 1}z`;
  }
  return path;
}

const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: rabat.timeZone,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** The time in Rabat, `03:12`. */
export const rabatTime = (time: number) => clock.format(time);

/**
 * Whether the browser's tzdata knows Morocco's current rules: +00 for good since 2026-09-20
 * 01:00 UTC (tzdata 2026c). An older browser still says +01 and would put the lamp an hour off,
 * so the room then leaves the lamp and the note alone. If Morocco changes its clocks again,
 * this check moves with the new rules.
 */
export const knowsRabatTime = () => rabatTime(Date.UTC(2026, 9, 1, 12)) === '12:00';

/** Between 02:00 and 07:00 in Rabat the lamp is turned down: probably asleep. */
export function isLate(time: number): boolean {
  const hour = Number(rabatTime(time).slice(0, 2));
  return hour >= 2 && hour < 7;
}
