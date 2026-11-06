// The scrub control under the room (ADR 0044), loaded on first touch: it reads the slider, draws
// the parts of the room only a past day changes, and lists what the day's records say. Which date
// shows and what it says are src/lib/room-scrub.ts's and src/lib/room-day.ts's; this file renders.
// The slider counts days back from today, so 0 is always now and the page needs no script to
// start at the right end, and its keys are the browser's own: arrows, Home and End. The keys 1
// to 7 ignore an input (room.ts), so they cannot meet.

import { rabatDate } from '@min7/contracts/rabat';
import { dayPath } from '../lib/day-words.ts';
import { ask } from '../lib/live.ts';
import { toNode } from '../lib/markup.ts';
import { hotspotWords, type RoomObject, roomObjects } from '../lib/room.ts';
import { dateBack, dateTitle, dayInstant, daysBack } from '../lib/room-day.ts';
import { booksMarkup, pinsMarkup, screenMarkup } from '../lib/room-markup.ts';
import { scrubber } from '../lib/room-scrub.ts';
import {
  changedParts,
  type PastDay,
  type RoomInputs,
  type RoomState,
  roomState,
} from '../lib/room-state.ts';

const reading = 'Reading…';

export function startScrub(
  root: HTMLElement,
  scene: HTMLElement,
  inputs: RoomInputs,
  hold: (state: Pick<RoomState, 'window' | 'lamp' | 'record'> | null) => void
): void {
  const slider = root.querySelector('input') as HTMLInputElement;
  const title = root.querySelector('.room-scrub-date') as HTMLElement;
  const read = root.querySelector('.room-scrub-read') as HTMLAnchorElement;
  const back = root.querySelector('.room-scrub-now') as HTMLButtonElement;
  const facts = root.querySelector('.room-scrub-facts') as HTMLElement;
  const status = root.querySelector('[role="status"]') as HTMLElement;
  const idle = title.textContent;
  const { from, daysSrc } = root.dataset as { from: string; daysSrc: string };
  const today = () => rabatDate(Date.now());
  let shown: string | null = null;
  let pages = new Set<string>();

  const layer = (selector: string, nodes: Parameters<typeof toNode>[0][]) =>
    (scene.querySelector(selector) as HTMLElement).replaceChildren(...nodes.map(toNode));
  const label = (object: RoomObject, state: RoomState) => {
    const span = scene.querySelector(`[data-room="${object.id}"] span`) as HTMLElement;
    span.textContent = hotspotWords(object, state);
  };
  const [corkboard, frame, notebook] = roomObjects;
  let objects: RoomState = roomState(inputs, { kind: 'live', instant: Date.now() });

  /** The objects a past day changes; room.ts draws the window, the lamp and the record. */
  function drawObjects(state: RoomState) {
    const changed = changedParts(objects, state);
    objects = state;
    if (changed.includes('pins')) {
      layer('.room-pins', pinsMarkup(state.pins));
      label(corkboard, state);
    }
    if (changed.includes('screen')) {
      layer('.room-screen', screenMarkup(state.screen));
      label(frame, state);
    }
    if (changed.includes('shelf')) {
      layer('.room-books', booksMarkup(state.shelf));
      label(notebook, state);
    }
  }

  const pastState = (date: string, day: PastDay) =>
    roomState(inputs, { kind: 'past', instant: dayInstant(date), day });

  const lines = ({ pins, screen, record, window }: ReturnType<typeof pastState>) => [
    pins.words ?? reading,
    screen.words ?? reading,
    record.words ?? reading,
    window.label,
  ];

  const scrub = scrubber({
    ask: (series, month) => ask(daysSrc.replace('{series}', series).replace('{month}', month)),
    now: Date.now,
    show(date, day) {
      shown = date;
      const past = date !== null && day !== null;
      root.toggleAttribute('data-past', past);
      facts.hidden = back.hidden = !past;
      read.hidden = !(past && pages.has(date));
      if (!past) {
        title.textContent = idle;
        slider.setAttribute('aria-valuetext', 'Now');
        facts.replaceChildren();
        drawObjects(roomState(inputs, { kind: 'live', instant: Date.now() }));
        hold(null);
        return;
      }
      const words = dateTitle(date, today());
      const state = pastState(date, day);
      title.textContent = words;
      slider.setAttribute('aria-valuetext', words);
      read.href = dayPath(date);
      facts.replaceChildren(
        ...lines(state).map((line) => {
          const row = document.createElement('li');
          row.textContent = line;
          return row;
        })
      );
      drawObjects(state);
      const { window, lamp, record } = state;
      hold({ window, lamp, record });
    },
    say(date, day) {
      status.textContent = [dateTitle(date, today()), ...lines(pastState(date, day))].join('. ');
    },
  });

  /** Keeps the slider's ends and place true as the days pass. */
  function sync() {
    const now = today();
    slider.min = String(-daysBack(from, now));
    if (shown !== null) slider.value = String(-daysBack(shown, now));
  }

  function moved() {
    const days = -Number(slider.value);
    scrub.go(days === 0 ? null : dateBack(today(), days));
  }

  slider.addEventListener('input', moved);
  back.addEventListener('click', () => {
    slider.value = '0';
    scrub.go(null);
    status.textContent = 'Back to now.';
    slider.focus();
  });
  setInterval(sync, 60_000);

  // Which dates have a page is the build's to say; without it no day links, and nothing else changes.
  ask('/day/index.json').then((body) => {
    const { dates } = Object(body);
    if (!Array.isArray(dates)) return;
    pages = new Set(dates);
    read.hidden = shown === null || !pages.has(shown);
  });

  sync();
  // The slider may have moved while this file loaded.
  if (slider.value !== '0') moved();
}
