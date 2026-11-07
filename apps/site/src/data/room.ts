// The room's inputs as this build reads them (ADR 0043), for the home page and the terminal.
import { dailySources, staleAfterSeconds } from '@min7/contracts';
import { getPosts } from '../lib/posts.ts';
import { roomSeed as seedFrom } from '../lib/room-seed.ts';
import type { RoomSeed } from '../lib/room-state.ts';
import { isoDay } from '../lib/writing.ts';
import { signals, signalsMode } from './signals.ts';

export const roomSeed = async (): Promise<RoomSeed> =>
  seedFrom({
    posts: (await getPosts()).map(({ data }) => ({ title: data.title, date: isoDay(data.date) })),
    shipping: await signals.read('shipping'),
    usage: await signals.read('llm-usage'),
    listening: await signals.read('listening'),
    origin: signalsMode === 'fixtures' ? 'sample' : 'build',
    builtAt: Date.now(),
    listeningLimitMs: staleAfterSeconds.listening * 1000,
  });

/**
 * The first date any daily series holds, where the room's scrub begins (ADR 0044), or null with
 * none. A month that could not be read only starts the range later.
 */
export async function scrubFrom(): Promise<string | null> {
  const histories = await Promise.all(dailySources.map((series) => signals.readHistory(series)));
  const firsts = histories.flatMap(({ days }) => days.slice(0, 1).map(({ date }) => date));
  return firsts.sort()[0] ?? null;
}
