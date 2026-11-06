// The room's inputs as this build reads them (ADR 0043), for the home page and the terminal.
import { staleAfterSeconds } from '@min7/contracts';
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
