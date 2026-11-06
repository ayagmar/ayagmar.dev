import type { RoomState } from './room-state.ts';

/**
 * The objects in the home page room and where each one leads (ADR 0026), in reading order:
 * left to right across the scene. The hotspots over the scene and the list under it both
 * render from this, so they always reach the same pages. Each object's rectangle on the scene
 * is in src/styles/room.css, keyed by `id`. The shelf in the scene leads nowhere: its spines are
 * decoration, and the Notebook says what they count (ADR 0043).
 */
export const roomObjects = [
  { id: 'corkboard', object: 'Corkboard', section: 'shipping', href: '/stats#shipping' },
  { id: 'frame', object: 'Framed screen', section: 'LLM usage', href: '/stats#llm-usage' },
  { id: 'notebook', object: 'Notebook', section: 'writing', href: '/writing' },
  { id: 'monitor', object: 'Monitor', section: 'projects', href: '/projects' },
  { id: 'keyboard', object: 'Keyboard', section: 'TIL', href: '/til' },
  { id: 'tea', object: 'Tea set', section: 'about', href: '/about' },
  { id: 'record-player', object: 'Record player', section: 'music', href: '/stats#listening' },
] as const;

export type RoomObject = (typeof roomObjects)[number];

/** The one fact an object says, or nothing. */
function roomFact(id: RoomObject['id'], state: RoomState) {
  if (id === 'corkboard') return state.pins.words;
  if (id === 'frame') return state.screen.words;
  if (id === 'notebook') return state.shelf.words;
  return id === 'record-player' ? state.record.words : null;
}

/** A hotspot's name: `Notebook: writing. 3 posts, newest: Token logs.` */
export function hotspotWords({ id, object, section }: RoomObject, state: RoomState): string {
  const fact = roomFact(id, state);
  return `${object}: ${section}${fact === null ? '' : `. ${fact}.`}`;
}

export const catName =
  'A ginger cat asleep on the windowsill. It keeps the night shift until five.';
export const catNote = 'The cat keeps the night shift until five.';
