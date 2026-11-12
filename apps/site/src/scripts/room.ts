// The room on the home page: it keeps one complete set of inputs, seeded from the build and
// merged with each answer, and draws what `roomState` (src/lib/room-state.ts, ADR 0043) says of
// it. Nothing is decided here. The window, the lamp and the cat follow Rabat's clock (ADR 0027);
// the weather comes from signals (ADR 0029) when the page has its endpoint, and the record and
// the Listening panel's line from `/v1/listening` (ADR 0015). The corkboard, the shelf and the
// framed screen stay as the build drew them, until a reader scrubs to a past day: the control
// loads src/scripts/room-scrub.ts on first touch (ADR 0044), and the live answers keep arriving
// behind it. Also the keys 1 to 7, which open the rows of the list under the scene in order,
// unless the list of keys has turned single-key shortcuts off. The hotspots are out of the Tab
// order as built, since from 60 rem the list reaches the same pages (ADR 0051); narrower, where
// the list is the way in, this puts them back. Without this script the room is the build's: the
// static scene of the page's theme, with no moon, note, cat or weather; a browser with outdated
// time zone rules gets the sky and the moon, but not the lamp, the note or the cat.

import { readListening } from '../lib/listening.ts';
import { live, poll } from '../lib/live-page.ts';
import { renderNowPlaying } from '../lib/now-playing-page.ts';
import { knowsRabat } from '../lib/rabat-date.ts';
import { roomObjects, sayFact } from '../lib/room.ts';
import { changedParts, liveReading, roomClock, seededInputs } from '../lib/room-clock.ts';
import type { RoomSeed, RoomState } from '../lib/room-state.ts';
import { moonPath } from '../lib/sky.ts';

const scene = document.querySelector('.scene') as HTMLElement;
const view = document.querySelector('.room-window');
const moon = document.querySelector('.room-moon path');
const note = document.querySelector('.room-note') as HTMLElement;
const seed: RoomSeed = JSON.parse(scene.dataset.roomSeed as string);
const inputs = seededInputs(seed, knowsRabat());

type Clocked = Pick<RoomState, 'window' | 'lamp' | 'record'>;

// The room as it is now, starting with what the build drew; `painted` is what the scene shows,
// and `past` the day a reader has scrubbed to, if any.
let drawn: Clocked = roomClock(inputs, { kind: 'built', instant: seed.builtAt });
let painted = drawn;
let past: Clocked | null = null;

/** The parts of the room this page keeps current; the others stay as the build drew them. */
const draw: Record<keyof Clocked, (state: Clocked) => void> = {
  window({ window }) {
    if (window === null) return;
    scene.dataset.sky = window.sky;
    scene.dataset.weather = window.weather?.state ?? 'none';
    moon?.setAttribute('d', window.moonShown ? moonPath(window.moon) : '');
    view?.setAttribute('role', 'img');
    view?.setAttribute('aria-label', window.label);
  },
  lamp({ lamp }) {
    if (lamp === null) return;
    scene.toggleAttribute('data-late', lamp.late);
    scene.toggleAttribute('data-cat', lamp.cat);
    note.hidden = !lamp.late;
    (note.querySelector('time') as HTMLElement).textContent = lamp.time;
  },
  record(state) {
    if (state.record.state === 'unknown') delete scene.dataset.record;
    else scene.dataset.record = state.record.state;
    sayFact(roomObjects[6], state.record.words);
  },
};

/** Redraws what differs from what the scene shows. */
function paint(state: Clocked) {
  for (const part of changedParts(painted, state)) draw[part](state);
  painted = state;
}

/** The room at `instant`. The Listening panel always says what is true now, scrubbed or not. */
function show(instant: number) {
  const next = roomClock(inputs, { kind: 'live', instant });
  const { line } = next.record;
  if (line !== null && changedParts(drawn, next).includes('record')) {
    renderNowPlaying(document.querySelector('.now-playing') as HTMLElement, line);
  }
  drawn = next;
  paint(past ?? next);
}

// Every 15 minutes while the page is visible: signals pulls Open-Meteo that often. `poll` runs this
// on load, every minute and when the tab comes back, which is also the room's clock. On a failed
// request the window drops its weather. Without an endpoint (fixtures mode) no request is made.
poll(scene.dataset.weatherSrc, 15 * 60_000, (answer, now, failed) => {
  inputs.weather = failed ? undefined : answer;
  show(now);
});

live('listening', 60_000, readListening, (_panel, answer, now) => {
  inputs.listening = liveReading(answer, now ? answer.at + seed.listeningLimitMs : null);
  show(Date.now());
});

const scrub = document.querySelector<HTMLElement>('.room-scrub');
// A past date needs Rabat's real calendar: with old rules, today could pass for a finished day.
if (!inputs.knowsRabat) scrub?.remove();
let woken = false;
const wake = () => {
  if (woken) return;
  woken = true;
  import('./room-scrub.ts')
    .then((module) =>
      module.startScrub(scrub as HTMLElement, scene, inputs, (state) => {
        past = state;
        show(Date.now());
      })
    )
    .catch(() => {
      // The room stays live; the next touch asks again.
      woken = false;
      (scrub?.querySelector('input') as HTMLInputElement).value = '0';
      (scrub?.querySelector('.room-scrub-failed') as HTMLElement).hidden = false;
    });
};
for (const touch of ['focusin', 'pointerdown', 'input']) scrub?.addEventListener(touch, wake);

const wide = matchMedia('(min-width: 60rem)');
const tabStops = () => {
  for (const spot of scene.querySelectorAll('.hotspot')) {
    if (wide.matches) spot.setAttribute('tabindex', '-1');
    else spot.removeAttribute('tabindex');
  }
};
tabStops();
wide.addEventListener('change', tabStops);

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
  if (/^[1-9]$/.test(event.key)) link?.click();
});
