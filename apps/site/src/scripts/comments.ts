// Loads the comments window's giscus iframe when the reader asks, and keeps it in step with the
// site's theme (ADR 0036). The URL and the widget's messages are in src/lib/comments.ts.

import { readMessage, themeFor, widgetUrl } from '../lib/comments.ts';
import { comments } from '../lib/site.ts';

const section = document.querySelector<HTMLElement>('[data-comments]');
const button = section?.querySelector<HTMLButtonElement>('[data-comments-open]');
const status = section?.querySelector<HTMLElement>('[data-comments-status]');
const holder = section?.querySelector<HTMLElement>('[data-comments-frame]');
const term = section?.dataset.term;

// giscus keeps the reader's GitHub sign-in under this key, as its own client.js does.
const sessionKey = 'giscus-session';
// Long enough for a slow connection; a blocked or offline widget never answers.
const patience = 10_000;

const root = document.documentElement;
const dark = matchMedia('(prefers-color-scheme: dark)');
const isDark = () => (root.dataset.theme ? root.dataset.theme === 'night' : dark.matches);

function stored(): string | null {
  try {
    const value = localStorage.getItem(sessionKey);
    return value === null ? null : JSON.parse(value);
  } catch {
    return null;
  }
}

function keep(session: string | null) {
  try {
    if (session === null) localStorage.removeItem(sessionKey);
    else localStorage.setItem(sessionKey, JSON.stringify(session));
  } catch {
    // Not stored: the reader signs in again next time.
  }
}

// What giscus returns to after signing in: this page, without its own parameter.
const here = new URL(location.href);
const returned = here.searchParams.get('giscus');
here.searchParams.delete('giscus');
here.hash = '';

let frame: HTMLIFrameElement | undefined;
let heard = false;
let applied = isDark();
let timer: ReturnType<typeof setTimeout> | undefined;

function show(state: 'idle' | 'loading' | 'ready' | 'failed') {
  if (!section || !status) return;
  section.dataset.state = state;
  status.textContent =
    state === 'loading'
      ? 'Loading comments…'
      : state === 'failed'
        ? 'Comments could not load. The link above still works.'
        : '';
}

function sync() {
  const wanted = isDark();
  if (!frame?.contentWindow || !heard || wanted === applied) return;
  applied = wanted;
  frame.contentWindow.postMessage(
    { giscus: { setConfig: { theme: themeFor(wanted) } } },
    comments.origin
  );
}

function open() {
  if (!holder || !term || frame) return;
  applied = isDark();
  frame = document.createElement('iframe');
  frame.title = 'Comments';
  frame.src = widgetUrl({ page: `${here}#comments`, term, dark: applied, session: stored() });
  holder.append(frame);
  show('loading');
  timer = setTimeout(() => show('failed'), patience);
}

window.addEventListener('message', (event) => {
  const message = readMessage(event, frame?.contentWindow);
  if (!message || !frame) return;
  heard = true;
  clearTimeout(timer);
  show('ready');
  if (message.height !== undefined) frame.style.height = `${message.height}px`;
  if (message.forgetSession && stored() !== null) {
    keep(null);
    heard = false;
    frame.src = widgetUrl({ page: `${here}#comments`, term: term ?? '', dark: isDark() });
    applied = isDark();
    return;
  }
  sync();
});

new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
dark.addEventListener('change', sync);

if (button) {
  button.hidden = false;
  button.addEventListener('click', open);
}

// Back from signing in on GitHub: the reader had the comments open, so open them again.
if (returned) {
  keep(returned);
  history.replaceState(history.state, '', here);
  open();
  section?.scrollIntoView();
}
