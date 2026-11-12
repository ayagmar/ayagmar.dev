// Says how old /now is, next to its date, and shows its out-of-date notice while the page was last
// updated more than 90 days before the reader's clock, not the build's: the page is rebuilt rarely
// and may be served long after (ADR 0035). The clock is read again whenever the page comes back
// (history restore, tab or window focus), at the reader's midnight and when the 90 days run out
// while it is open, and both follow it either way.

import { daysAgo } from '../lib/days-ago.ts';
import { isStale, staleFrom } from '../lib/now.ts';

const notice = document.querySelector<HTMLElement>('[data-stale-after]');
const updated = notice?.dataset.updated;
const age = document.querySelector<HTMLElement>('[data-age-of]');

// setTimeout keeps at most 2^31 - 1 ms; a longer wait is taken in steps.
const longestWait = 2 ** 31 - 1;
let timer: ReturnType<typeof setTimeout> | undefined;

function refresh() {
  if (!notice || !updated) return;
  const now = Date.now();
  notice.hidden = !isStale(updated, now);
  if (age?.dataset.ageOf) age.textContent = `, ${daysAgo(age.dataset.ageOf, now)}`;
  clearTimeout(timer);
  const stale = staleFrom(updated) - now;
  const midnight = new Date(now).setHours(24, 0, 0, 0) - now;
  const wait = stale > 0 ? Math.min(stale, midnight) : midnight;
  timer = setTimeout(refresh, Math.min(wait, longestWait));
}

refresh();
addEventListener('pageshow', refresh);
addEventListener('focus', refresh);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh();
});
