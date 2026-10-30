// Shows /now's out-of-date notice while the page was last updated more than 90 days before the
// reader's clock, not the build's: the page is rebuilt rarely and may be served long after
// (ADR 0035). The clock is read again whenever the page comes back (history restore, tab or
// window focus) and when the 90 days run out while it is open, and the notice follows it both ways.
import { isStale, staleFrom } from '../lib/now.ts';

const notice = document.querySelector<HTMLElement>('[data-stale-after]');
const updated = notice?.dataset.updated;

// setTimeout keeps at most 2^31 - 1 ms; a longer wait is taken in steps.
const longestWait = 2 ** 31 - 1;
let timer: ReturnType<typeof setTimeout> | undefined;

function refresh() {
  if (!notice || !updated) return;
  const now = Date.now();
  notice.hidden = !isStale(updated, now);
  clearTimeout(timer);
  const wait = staleFrom(updated) - now;
  if (wait > 0) timer = setTimeout(refresh, Math.min(wait, longestWait));
}

refresh();
addEventListener('pageshow', refresh);
addEventListener('focus', refresh);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh();
});
