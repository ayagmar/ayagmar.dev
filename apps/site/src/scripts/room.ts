// The room on the home page: it keeps one complete set of inputs, seeded from the build and
// merged with each answer, and draws what `roomState` (src/lib/room-state.ts, ADR 0043) says of
// it. Nothing is decided here. The window, the lamp and the cat follow Rabat's clock (ADR 0027);
// the weather comes from signals (ADR 0029) when the page has its endpoint, and the record and
// the Listening panel's line from `/v1/listening` (ADR 0015). The corkboard, the shelf and the
// framed screen stay as the build drew them. Also the keys 1 to 7, which open the room's objects
// in reading order, unless the list of keys has turned single-key shortcuts off. Without this
// script the room is the build's: the static scene of the page's theme, with no moon, note, cat
// or weather; a browser with outdated time zone rules gets the sky and the moon, but not the
// lamp, the note or the cat.

import { readListening, renderNowPlaying } from '../lib/listening.ts';
import { live, poll } from '../lib/live.ts';
import { knowsRabat } from '../lib/rabat-date.ts';
import { hotspotWords, roomObjects } from '../lib/room.ts';
import {
  changedParts,
  liveReading,
  type RoomSeed,
  type RoomState,
  roomState,
  seededInputs,
} from '../lib/room-state.ts';
import { moonPath } from '../lib/sky.ts';

const scene = document.querySelector('.scene') as HTMLElement;
const view = document.querySelector('.room-window');
const moon = document.querySelector('.room-moon path');
const note = document.querySelector('.room-note') as HTMLElement;
const seed: RoomSeed = JSON.parse(scene.dataset.roomSeed as string);
const inputs = seededInputs(seed, knowsRabat());

// What the page shows now, starting with what the build drew.
let drawn = roomState(inputs, { kind: 'built', instant: seed.builtAt });

/** The parts of the room this page keeps current; the others stay as the build drew them. */
const draw: Partial<Record<keyof RoomState, (state: RoomState) => void>> = {
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
    const { line } = state.record;
    if (line === null) return;
    scene.dataset.record = state.record.state;
    renderNowPlaying(document.querySelector('.now-playing') as HTMLElement, line);
    const object = roomObjects[6];
    const label = scene.querySelector(`[data-room="${object.id}"] span`) as HTMLElement;
    label.textContent = hotspotWords(object, state);
  },
};

/** Redraws what differs from what the page shows at `instant`. */
function show(instant: number) {
  const next = roomState(inputs, { kind: 'live', instant });
  for (const part of changedParts(drawn, next)) draw[part]?.(next);
  drawn = next;
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
