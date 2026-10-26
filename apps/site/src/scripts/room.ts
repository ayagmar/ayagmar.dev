// The room's clock on the home page (ADR 0027): the window shows the sky and the moon over
// Casablanca now, and between 02:00 and 07:00 there the lamp is turned down with a note. Also
// the keys 1 to 7, which open the room's objects in reading order. Without this script the room
// is the static scene of the page's theme, with no moon and no note.
import { casablancaTime, isLate, moonAt, moonPath, skyAt } from '../lib/sky.ts';

const scene = document.querySelector<HTMLElement>('.scene');
const view = document.querySelector('.room-window');
const moon = document.querySelector('.room-moon path');
const note = document.querySelector<HTMLElement>('.room-note');

function tick() {
  if (scene === null) return;
  const now = Date.now();
  const sky = skyAt(now);
  const phase = moonAt(now);
  const late = isLate(now);
  scene.dataset.sky = sky;
  scene.toggleAttribute('data-late', late);
  // A moon this thin would be a single pixel or none: leave it out.
  moon?.setAttribute(
    'd',
    sky === 'day' || phase.fraction < 0.03 ? '' : moonPath(phase, 122, 25, 6)
  );
  view?.setAttribute('role', 'img');
  view?.setAttribute(
    'aria-label',
    sky === 'day'
      ? 'Through the window: daylight over Casablanca.'
      : `Through the window: ${sky} over Casablanca, a ${phase.name}.`
  );
  if (note !== null) {
    note.hidden = !late;
    const time = note.querySelector('time');
    if (time !== null) time.textContent = casablancaTime(now);
  }
}

tick();
setInterval(tick, 60_000);

document.addEventListener('keydown', (event) => {
  const target = event.target;
  if (event.ctrlKey || event.metaKey || event.altKey || document.querySelector('dialog[open]'))
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
