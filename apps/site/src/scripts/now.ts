// Shows /now's out-of-date notice when the page was last updated long before the reader's clock,
// not the build's: the page is rebuilt rarely and may be served long after (ADR 0035).
import { isStale } from '../lib/now.ts';

const notice = document.querySelector<HTMLElement>('[data-stale-after]');
const updated = notice?.dataset.updated;
if (notice && updated && isStale(updated, Date.now())) notice.hidden = false;
