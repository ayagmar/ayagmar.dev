/**
 * The objects in the home page room and where each one leads (ADR 0026), in reading order:
 * left to right across the scene. The hotspots over the scene and the list under it both
 * render from this, so they always reach the same pages. Each object's rectangle on the scene
 * is in src/styles/room.css, keyed by `id`.
 */
export const roomObjects = [
  { id: 'corkboard', object: 'Corkboard', section: 'shipping', href: '/stats#shipping' },
  { id: 'frame', object: 'Framed screen', section: 'LLM usage', href: '/stats#llm-usage' },
  { id: 'notebook', object: 'Notebook', section: 'writing', href: '/writing' },
  { id: 'monitor', object: 'Monitor', section: 'projects', href: '/projects' },
  { id: 'keyboard', object: 'Keyboard', section: 'TIL', href: '/til' },
  { id: 'tea', object: 'Tea set', section: 'about', href: '/about' },
  { id: 'record-player', object: 'Record player', section: 'music', href: '/stats#listening' },
  { id: 'shelf', object: 'Shelf', section: 'reading', href: '/stats#shelf' },
] as const;
