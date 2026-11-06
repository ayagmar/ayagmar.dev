/**
 * What the room's objects hold, as markup (src/lib/markup.ts): the build renders it into home's
 * HTML and a past day into the DOM (src/scripts/room-scrub.ts), so the two cannot drift.
 */
import { el, type Markup } from './markup.ts';
import type { RoomState } from './room-state.ts';

export const pinsMarkup = ({ pins }: RoomState['pins']): Markup[] =>
  pins.map(({ kind, count }) =>
    el(
      'li',
      { 'data-kind': kind },
      ...Array.from({ length: Math.min(count, 3) }, () => el('i', {}))
    )
  );

export const screenMarkup = ({ cells }: RoomState['screen']): Markup[] =>
  cells.map(({ level }) => el('i', { 'data-l': String(level ?? 'none') }));

export const booksMarkup = ({ books }: RoomState['shelf']): Markup[] =>
  books.map(({ tone }) => el('li', { 'data-tone': String(tone) }));
