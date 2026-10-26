// repo-pulse public feed (ADR 0012): recent public events and star history.
import {
  githubOwner,
  repoPulseFeedEventSchema,
  repoPulseFeedReaderSchema,
  repoPulseStarHistorySchema,
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
      starHistory: feed.starHistory.flatMap((item) => {
        const parsed = repoPulseStarHistorySchema.safeParse(item);
        return parsed.success && isOwn(parsed.data.repo) ? [parsed.data] : [];
      }),
    });
  },
};

// The feed promises public repositories only; anything outside the owner's account is
// dropped as well, in case repo-pulse ever watches another one.
const isOwn = (repo: string) => repo.startsWith(`${githubOwner}/`);

/**
 * Feed events as the site shows them, newest first whatever order the feed used. Events of
 * an unknown type, with a bad field or outside the owner's account are skipped. Stars on one
 * repository on one UTC day become one `stars` entry, placed where the newest of them was.
 */
function summarize(items: readonly unknown[]): ShippingEvent[] {
  const events = items
    .flatMap((item) => {
      const parsed = repoPulseFeedEventSchema.safeParse(item);
      return parsed.success && isOwn(parsed.data.repo) ? [parsed.data] : [];
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const summary: ShippingEvent[] = [];
  const starDays = new Map<string, Extract<ShippingEvent, { type: 'stars' }>>();
  for (const event of events) {
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
