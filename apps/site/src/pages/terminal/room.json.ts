// What the Worker needs to answer /room (ADR 0045): where this build is served, where to ask for
// live answers, none in fixtures mode, how long a track may count as playing, which the Worker
// cannot read from contracts without loading zod, and the build's own answers, shown when
// signals does not answer.
import { WORKERS_CI_BRANCH } from 'astro:env/server';
import { staleAfterSeconds } from '@min7/contracts';
import type { APIRoute } from 'astro';
import { signals, signalsApiBase, signalsMode } from '../../data/signals.ts';
import { buildOrigin } from '../../lib/og.ts';

export const GET: APIRoute = async () =>
  Response.json({
    origin: buildOrigin(WORKERS_CI_BRANCH),
    signals: signalsMode === 'api' ? signalsApiBase : null,
    listeningLimitMs: staleAfterSeconds.listening * 1000,
    listening: await signals.read('listening'),
    shipping: await signals.read('shipping'),
  });
