/**
 * The room in a terminal (ADR 0045): the scene as truecolor half-blocks, with the sky, the moon
 * and the latest track and commit under it. Pure functions; the build shrinks the scene's PNGs
 * into frames (src/pages/terminal/) and the site Worker renders one per request (worker/room.ts).
 * Every word comes from the module that words it for the page.
 */
import type { ListeningSnapshot, ShippingEvent, ShippingSnapshot } from '@min7/contracts';
import { nowPlaying, nowPlayingMarkup } from './listening.ts';
import { el } from './markup.ts';
import { inline } from './markup-text.ts';
import { curlTarget, identityLines, sampleNote, textPages } from './site.ts';
import {
  isLate,
  knowsRabatTime,
  type Moon,
  moonAt,
  moonColour,
  moonRuns,
  moonShown,
  rabatTime,
  type Sky,
  skyAt,
  windowWords,
} from './sky.ts';
import { shippingItem } from './stats-panels.ts';

/** The scene is 480x160. One cell is 6x6 of its pixels, so 80 columns; its last 4 rows go. */
export const scene = { width: 480, height: 160 } as const;
const cell = 6;
const columns = scene.width / cell;
const rows = Math.floor(scene.height / cell / 2) * 2;

/** Each frame's layers, under src/assets/: the room, and the view through its window. */
export const frames = {
  day: ['room-day', 'window-day'],
  dusk: ['room-night', 'window-dusk'],
  'dusk-dim': ['room-night-dim', 'window-dusk'],
  night: ['room-night', 'window-night'],
  'night-dim': ['room-night-dim', 'window-night'],
} as const;

export type Frame = keyof typeof frames;

/** What the picture shows at an instant. The one input a later room model has to supply. */
export interface RoomFacts {
  sky: Sky;
  moon: Moon;
  /** The lamp is turned down. */
  late: boolean;
  /** The time in Rabat, `03:12`. */
  time: string;
}

/** As src/scripts/room.ts reads them: outdated tzdata leaves the lamp alone. */
export const roomFacts = (time: number): RoomFacts => ({
  sky: skyAt(time),
  moon: moonAt(time),
  late: knowsRabatTime() && isLate(time),
  time: rabatTime(time),
});

/** The terminal has no theme, so the sky picks the room: the lamp is on from dusk. */
export const frameFor = ({ sky, late }: RoomFacts): Frame =>
  sky === 'day' ? 'day' : late ? `${sky}-dim` : sky;

/** The mean colour of each cell of a 480x160 RGB image, as `columns` by `rows` RGB pixels. */
export function shrink(image: Uint8Array): Uint8Array {
  const out = new Uint8Array(columns * rows * 3);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      for (let channel = 0; channel < 3; channel++) {
        let sum = 0;
        for (let y = row * cell; y < (row + 1) * cell; y++) {
          for (let x = column * cell; x < (column + 1) * cell; x++) {
            sum += image[(y * scene.width + x) * 3 + channel] ?? 0;
          }
        }
        out[(row * columns + column) * 3 + channel] = Math.round(sum / cell ** 2);
      }
    }
  }
  return out;
}

const moonRgb = [1, 3, 5].map((at) => Number.parseInt(moonColour.slice(at, at + 2), 16));

/**
 * `frame` with the moon laid over it. The scene's 12-pixel disc covers about two cells a side,
 * so the phase shows as how bright they are; the words under the picture name it.
 */
function withMoon(frame: Uint8Array, { sky, moon }: RoomFacts): Uint8Array {
  if (!moonShown(sky, moon)) return frame;
  const lit = new Map<number, number>();
  moonRuns(moon, (x, y, width) => {
    for (let at = x; at < x + width; at++) {
      const index = Math.floor(y / cell) * columns + Math.floor(at / cell);
      lit.set(index, (lit.get(index) ?? 0) + 1);
    }
  });
  const out = frame.slice();
  for (const [index, pixels] of lit) {
    const share = pixels / cell ** 2;
    moonRgb.forEach((colour, channel) => {
      const at = index * 3 + channel;
      out[at] = Math.round((out[at] ?? 0) * (1 - share) + colour * share);
    });
  }
  return out;
}

/** Two pixels a character: `▀` in the upper one's colour on the lower one's. */
function halfBlocks(frame: Uint8Array): string[] {
  const rgb = (row: number, column: number) =>
    frame.subarray((row * columns + column) * 3, (row * columns + column) * 3 + 3).join(';');
  const lines = [];
  for (let row = 0; row < rows; row += 2) {
    let line = '';
    let upper = '';
    let lower = '';
    for (let column = 0; column < columns; column++) {
      const top = rgb(row, column);
      const bottom = rgb(row + 1, column);
      const codes = [
        ...(top === upper ? [] : [`38;2;${top}`]),
        ...(bottom === lower ? [] : [`48;2;${bottom}`]),
      ];
      line += `${codes.length === 0 ? '' : `\x1b[${codes.join(';')}m`}▀`;
      upper = top;
      lower = bottom;
    }
    lines.push(`${line}\x1b[0m`);
  }
  return lines;
}

const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

/** East Asian Wide and Fullwidth blocks, emoji, and text made emoji by a variation selector. */
const wide =
  /\p{Emoji_Presentation}|\uFE0F|[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6\u{20000}-\u{3FFFD}]/u;

/** How many terminal cells a grapheme takes: combining marks ride on their base. */
const graphemeCells = (grapheme: string) => (wide.test(grapheme) ? 2 : 1);

/** How many terminal cells `text` takes. */
export const terminalCells = (text: string) =>
  [...graphemes.segment(text)].reduce((sum, { segment }) => sum + graphemeCells(segment), 0);

/**
 * One line a terminal can show safely. Track and pull request titles are other people's text:
 * a control character in one would reach the reader's terminal as a command, so none get
 * through, nor the invisible format characters that could reorder the line. A longer line than
 * the picture is cut between graphemes, by cells rather than characters, for titles in CJK.
 */
export function terminalLine(text: string): string {
  const clean = text.replace(/[\p{Cc}\p{Cf}]/gu, '');
  if (terminalCells(clean) <= columns) return clean;
  let line = '';
  let cells = 1;
  for (const { segment } of graphemes.segment(clean)) {
    cells += graphemeCells(segment);
    if (cells > columns) break;
    line += segment;
  }
  return `${line}…`;
}

/** A listening answer to word, `now` while it still describes this moment. */
interface RoomListening {
  data: ListeningSnapshot;
  fetchedAt: string;
  now: boolean;
}

/** The newest event with commits in it: stars and releases say nothing about the code. */
const latestCommit = ({ events }: ShippingSnapshot) =>
  events.find((event: ShippingEvent) => event.type === 'push' || event.type === 'merge');

function listeningLine({ data, fetchedAt, now }: RoomListening): string {
  const { words, at } = nowPlayingMarkup(nowPlaying(data, fetchedAt, now));
  return inline(el('p', {}, ...words, ' ', ...(at === null ? [] : [at]))).trim();
}

export interface RoomText {
  listening: RoomListening | undefined;
  shipping: ShippingSnapshot | undefined;
  /** The answers are the build's fixtures: a line says so. */
  sample: boolean;
  /** Where this copy is served, so its commands work on a Preview. */
  origin: string;
}

/** The answer to `curl ayagmar.dev/room`, ending in how to get it without colour. */
export function renderTerminalRoom(
  frame: Uint8Array,
  facts: RoomFacts,
  { listening, shipping, sample, origin }: RoomText
): string {
  const commit = shipping === undefined ? undefined : latestCommit(shipping);
  const target = curlTarget(origin);
  return [
    ...halfBlocks(withMoon(frame, facts)),
    '',
    ...identityLines,
    '',
    `It is ${facts.time} in Rabat.`,
    windowWords(facts.sky, facts.moon),
    ...(listening === undefined ? [] : [terminalLine(listeningLine(listening))]),
    ...(commit === undefined ? [] : [terminalLine(`Shipped ${inline(shippingItem(commit))}`)]),
    ...(sample ? [sampleNote] : []),
    '',
    ...textPages.map(({ href }) => `  curl ${target}${href}`),
    '',
    `Without colour: curl ${target}`,
    '',
  ].join('\n');
}
