import type { RoomState } from './room-state.ts';
import { nav } from './site.ts';

/**
 * The objects in the home page room and where each one leads (ADR 0026), in reading order:
 * left to right across the scene, the order of the hotspots over it. The list under the scene
 * renders the same objects in `roomList` order, so both always reach the same pages. Each
 * object's rectangle on the scene is in src/styles/room.css, keyed by `id`. The shelf in the
 * scene leads nowhere: its spines are decoration, and the Notebook says what they count (ADR
 * 0043). `holds` is what the page holds, said in the list where the scene is cropped and the
 * object may be out of view (ADR 0051); Writing and TIL say their newest entry instead.
 */
export const roomObjects = [
  {
    id: 'corkboard',
    object: 'Corkboard',
    section: 'shipping',
    href: '/stats#shipping',
    holds: 'What I merged, by day',
  },
  {
    id: 'frame',
    object: 'Framed screen',
    section: 'LLM usage',
    href: '/stats#llm-usage',
    holds: 'My coding-agent use',
  },
  { id: 'notebook', object: 'Notebook', section: 'writing', href: '/writing', holds: null },
  {
    id: 'monitor',
    object: 'Monitor',
    section: 'projects',
    href: '/projects',
    holds: 'Tools I build',
  },
  { id: 'keyboard', object: 'Keyboard', section: 'TIL', href: '/til', holds: null },
  { id: 'tea', object: 'Tea set', section: 'about', href: '/about', holds: 'Work and contact' },
  {
    id: 'record-player',
    object: 'Record player',
    section: 'music',
    href: '/stats#listening',
    holds: "What I'm playing",
  },
] as const;

export type RoomObject = (typeof roomObjects)[number];

/** Where a page sits in the header's nav; a section of /stats sits where Stats does. */
const navRank = ({ href }: RoomObject) => nav.findIndex((item) => item.href === href.split('#')[0]);

/**
 * The list under the scene and the keys 1 to 7, in the nav's order (ADR 0051), the sections of
 * /stats in the scene's order. Sorting keeps them in step with `nav` without a second list.
 */
export const roomList = roomObjects.toSorted((a, b) => navRank(a) - navRank(b));

/** What a row says under its section where the scene is cropped: what its page holds. */
export const rowLine = (
  item: RoomObject,
  newest: { post: string | undefined; note: string | undefined }
) =>
  item.holds ??
  (item.id === 'notebook' ? (newest.post ?? 'No posts yet') : (newest.note ?? 'No notes yet'));

/** The one fact an object says, or nothing. */
export function roomFact(id: RoomObject['id'], state: RoomState) {
  if (id === 'corkboard') return state.pins.words;
  if (id === 'frame') return state.screen.words;
  if (id === 'notebook') return state.shelf.words;
  return id === 'record-player' ? state.record.words : null;
}

/** A hotspot's name: `Notebook: writing. 3 posts, newest: Token logs.` */
const hotspotName = ({ object, section }: RoomObject, fact: string | null) =>
  `${object}: ${section}${fact === null ? '' : `. ${fact}.`}`;

/** The name of `object`'s hotspot in `state`. */
export const hotspotWords = (object: RoomObject, state: RoomState) =>
  hotspotName(object, roomFact(object.id, state));

/**
 * What a row in the list adds for a screen reader from 60 rem, where the hotspots leave the Tab
 * order (ADR 0051): the fact its hotspot says, so the row says everything the hotspot does.
 */
export const rowFact = (fact: string | null) => (fact === null ? '' : `: ${fact}.`);

/** Says `fact` for `object` in the room on this page: on its hotspot and in its row. */
export function sayFact(object: RoomObject, fact: string | null) {
  const spot = document.querySelector(`[data-room="${object.id}"] span`);
  const row = document.querySelector(`[data-room-list="${object.id}"] .room-fact`);
  if (spot) spot.textContent = hotspotName(object, fact);
  if (row) row.textContent = rowFact(fact);
}

export const catName =
  'A ginger cat asleep on the windowsill. It keeps the night shift until five.';
export const catNote = 'The cat keeps the night shift until five.';
