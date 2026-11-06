// What the Worker needs to answer /room (ADR 0045): where this build is served, where to ask for
// live answers, none in fixtures mode, and the build's room inputs (ADR 0043), shown when signals
// does not answer.
import { WORKERS_CI_BRANCH } from 'astro:env/server';
import type { APIRoute } from 'astro';
import { roomSeed } from '../../data/room.ts';
import { signalsApiBase, signalsMode } from '../../data/signals.ts';
import { buildOrigin } from '../../lib/og.ts';

export const GET: APIRoute = async () =>
  Response.json({
    origin: buildOrigin(WORKERS_CI_BRANCH),
    signals: signalsMode === 'api' ? signalsApiBase : null,
    seed: await roomSeed(),
  });
