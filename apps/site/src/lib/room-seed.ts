/**
 * The inputs the build hands on (ADR 0043): only what the room can show, so the seed in the home
 * page's HTML stays small, and only named fields, so nothing the room must not say gets in.
 */
import type {
  Envelope,
  ListeningSnapshot,
  LlmUsageSnapshot,
  ShippingEvent,
  ShippingSnapshot,
} from '@min7/contracts';
import { instantMs } from './live.ts';
import {
  type Origin,
  pinKey,
  pinSlots,
  type Reading,
  type RoomPost,
  type RoomSeed,
  screenWeeks,
} from './room-state.ts';
import { dayMs, isoDate } from './words.ts';

/** The events the newest pins are made of. Stars never reach the room. */
function pinEvents(events: readonly ShippingEvent[]): ShippingEvent[] {
  const pins = new Set<string>();
  return events
    .filter(({ type }) => type !== 'stars')
    .filter((event) => {
      pins.add(pinKey(event));
      return pins.size <= pinSlots;
    });
}

interface BuiltRoom {
  /** Newest first, as `getPosts` gives them. */
  posts: readonly RoomPost[];
  shipping: Envelope<ShippingSnapshot, 'shipping'>;
  usage: Envelope<LlmUsageSnapshot, 'llm-usage'>;
  listening: Envelope<ListeningSnapshot, 'listening'>;
  origin: Extract<Origin, 'build' | 'sample'>;
  builtAt: number;
  listeningLimitMs: number;
}

export function roomSeed(built: BuiltRoom): RoomSeed {
  const { origin, builtAt, listeningLimitMs } = built;
  const reading = <Data, Kept>(
    { data, fetchedAt }: { data: Data | null; fetchedAt: string | null },
    keep: (data: Data) => Kept
  ): Reading<Kept> | null => {
    const at = instantMs(fetchedAt, true);
    if (data === null || fetchedAt === null || at === undefined) return null;
    return { data: keep(data), fetchedAt, at, origin, currentUntil: null };
  };
  // Twelve weeks reach past the screen's first Monday, and past the start of any month in it.
  const from = isoDate(builtAt - (screenWeeks + 1) * 7 * dayMs);
  return {
    builtAt,
    listeningLimitMs,
    inputs: {
      posts: built.posts.toReversed(),
      shipping: reading(built.shipping, ({ events }) => ({ events: pinEvents(events) })),
      usage: reading(built.usage, ({ days, monthToDate }) => ({
        monthTokens: monthToDate.totalTokens,
        days: days
          .filter(({ date }) => date >= from)
          .map(({ date, totalTokens }) => ({ date, totalTokens })),
      })),
      listening: reading(built.listening, ({ nowPlaying, recent }) => ({ nowPlaying, recent })),
    },
  };
}
