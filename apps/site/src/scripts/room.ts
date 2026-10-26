// The room's clock on the home page (ADR 0027): the window shows the sky and the moon over
// Rabat now, and between 02:00 and 07:00 there the lamp is turned down with a note. Over them,
// the current weather in Rabat from signals (ADR 0029), when the page has its endpoint (api
// data mode) and a usable answer. Also the keys 1 to 7, which open the room's objects in
// reading order, unless the list of keys has turned single-key shortcuts off. Without this
// script the room is the static scene of the page's theme, with no moon, note or weather; a
// browser with outdated time zone rules gets the sky and the moon, but not the lamp or the note.
import { isLate, knowsRabatTime, moonAt, moonPath, rabatTime, skyAt } from '../lib/sky.ts';
import { readWeather, type Weather } from '../lib/weather.ts';

const scene = document.querySelector<HTMLElement>('.scene');
const view = document.querySelector('.room-window');
const moon = document.querySelector('.room-moon path');
const note = document.querySelector<HTMLElement>('.room-note');
// Without Morocco's current rules the hour there is a guess: no lamp or note from it.
const knows = knowsRabatTime();
// `${SIGNALS_API_BASE}/v1/weather`, absent in fixtures mode: then no request and no weather.
const endpoint = scene?.dataset.weatherSrc;
// signals pulls Open-Meteo every 15 minutes; asking more often would show nothing new.
const refreshMs = 15 * 60_000;
// One request at a time, given up after this long, headers and body together.
const deadlineMs = 5_000;

let weather: Weather | undefined;
// When the last request started (ms); never yet.
let asked = 0;
let pending = false;

/**
 * Asks signals for the weather while the page is visible, one request at a time and at most
 * once per `refreshMs`. The request's own deadline covers the body too; at the deadline, or on
 * any failure or unusable answer, the window drops its weather.
 */
function refresh() {
  if (!endpoint || pending || document.hidden || Date.now() - asked < refreshMs) return;
  asked = Date.now();
  pending = true;
  const settle = (body?: unknown) => {
    pending = false;
    weather = readWeather(body, Date.now());
    tick();
  };
  fetch(endpoint, { signal: AbortSignal.timeout(deadlineMs) })
    .then((response) => response.json())
    .then(settle, () => settle());
}

/** The whole room clock, the window's label included: on every minute and weather change. */
function tick() {
  if (scene === null) return;
  const now = Date.now();
  const sky = skyAt(now);
  const phase = moonAt(now);
  const late = knows && isLate(now);
  if (weather !== undefined && now > weather.until) weather = undefined;
  scene.dataset.sky = sky;
  scene.dataset.weather = weather?.state ?? 'none';
  scene.toggleAttribute('data-late', late);
  // A moon this thin would be a single pixel or none: leave it out.
  moon?.setAttribute(
    'd',
    sky === 'day' || phase.fraction < 0.03 ? '' : moonPath(phase, 122, 25, 6)
  );
  view?.setAttribute('role', 'img');
  view?.setAttribute(
    'aria-label',
    `Through the window: ${sky === 'day' ? 'daylight over Rabat' : `${sky} over Rabat, a ${phase.name}`}${weather === undefined ? '' : `, ${weather.words}`}.`
  );
  if (note !== null) {
    note.hidden = !late;
    const time = note.querySelector('time');
    if (time !== null) time.textContent = rabatTime(now);
  }
  refresh();
}

tick();
setInterval(tick, 60_000);
// A hidden tab may not have run the timer: drop expired weather at once, and ask if due.
document.addEventListener('visibilitychange', tick);

document.addEventListener('keydown', (event) => {
  const target = event.target;
  // Off with the list's switch (theme.js), as every single-key shortcut.
  if (
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    document.documentElement.dataset.shortcuts ||
    document.querySelector('dialog[open]')
  )
    return;
  if (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.matches('input, textarea, select'))
  )
    return;
  const link =
    document.querySelectorAll<HTMLAnchorElement>('[data-room-list]')[Number(event.key) - 1];
  if (/^[1-9]$/.test(event.key) && link !== undefined) link.click();
});
