import type { APIRoute } from 'astro';
import { signals, signalsMode } from '../data/signals.ts';
import { textFile } from '../lib/plaintext.ts';
import { renderStatsText } from '../lib/stats-text.ts';

export const GET: APIRoute = async () =>
  textFile(
    renderStatsText(
      {
        listening: await signals.read('listening'),
        projects: await signals.read('projects'),
        typing: await signals.read('monkeytype'),
        shipping: await signals.read('shipping'),
        llmUsage: await signals.read('llm-usage'),
      },
      signalsMode === 'fixtures'
    )
  );
