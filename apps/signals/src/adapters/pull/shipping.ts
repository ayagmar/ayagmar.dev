// repo-pulse public feed (ADR 0012): recent public events and star history.
import {
  repoPulseFeedEventSchema,
  repoPulseFeedReaderSchema,
  type ShippingEvent,
  type ShippingSnapshot,
  shippingSnapshotSchema,
} from '@min7/contracts';
import type { PullAdapter } from '../types.ts';
import { checkSnapshot, getJson, parseBody, type UpstreamResponse } from './http.ts';

const feedLimit = 50;
const feedUrl = `https://repo-pulse.ayagmar.workers.dev/public/feed?limit=${feedLimit}`;
// 100 events and 50 repositories of 90-day star history stay well under this.
const maxBytes = 256 * 1024;

export const shipping: PullAdapter<UpstreamResponse, ShippingSnapshot> = {
  id: 'shipping',
  intervalSeconds: 15 * 60,

  fetch: (_env, signal) => getJson(feedUrl, { signal, maxBytes }),

  normalize(raw) {
    const feed = parseBody(raw, repoPulseFeedReaderSchema);
    return checkSnapshot(shippingSnapshotSchema, {
      events: summarize(feed.events).slice(0, feedLimit),
      starHistory: feed.starHistory,
    });
  },
};

/**
 * Feed events as the site shows them, newest first. Events of an unknown type or with a bad
 * field are skipped. Stars on one repository on one UTC day become one `stars` entry, placed
 * where the newest of them was.
 */
function summarize(events: readonly unknown[]): ShippingEvent[] {
  const summary: ShippingEvent[] = [];
  const starDays = new Map<string, Extract<ShippingEvent, { type: 'stars' }>>();
  for (const item of events) {
    const parsed = repoPulseFeedEventSchema.safeParse(item);
    if (!parsed.success) continue;
    const event = parsed.data;
    const { repo, at } = event;
    switch (event.type) {
      case 'release.published':
        summary.push({ type: 'release', repo, at, url: event.url, tag: event.release.tag });
        break;
      case 'push.default_branch':
        summary.push({ type: 'push', repo, at, url: event.url, commits: event.push.commits });
        break;
      case 'pull_request.merged':
        summary.push({
          type: 'merge',
          repo,
          at,
          url: event.url,
          number: event.pullRequest.number,
          title: event.pullRequest.title,
        });
        break;
      case 'star.created': {
        const key = `${repo} ${new Date(at).toISOString().slice(0, 10)}`;
        const day = starDays.get(key);
        if (day === undefined) {
          const entry = { type: 'stars' as const, repo, at, gained: 1, total: event.star.count };
          starDays.set(key, entry);
          summary.push(entry);
        } else {
          day.gained += 1;
        }
        break;
      }
    }
  }
  return summary;
}
