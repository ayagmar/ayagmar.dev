import {
  type ShelfSnapshot,
  shelfSnapshotSchema,
  type TrellisPush,
  trellisPushSchema,
} from '@min7/contracts';
import { byCodeUnit, type Producer } from './producers.ts';
import { habitLabels } from './public-labels.ts';

/**
 * Builds the published shelf snapshot field by field from the validated push. Titles are
 * public by design; habits without a reviewed label are dropped, and a repeated label keeps
 * its first entry.
 */
function projectShelf({ payload }: TrellisPush): ShelfSnapshot {
  const habits = new Map<string, ShelfSnapshot['habits'][number]>();
  for (const { habit, streakDays } of payload.habits) {
    const label = habitLabels.get(habit);
    if (label !== undefined && !habits.has(label)) habits.set(label, { habit: label, streakDays });
  }
  return {
    booksFinished: { year: payload.booksFinished.year, count: payload.booksFinished.count },
    inProgress: payload.inProgress.map(({ title, kind, progress }) => ({
      title,
      kind,
      progress: { current: progress.current, total: progress.total },
    })),
    habits: [...habits.values()].sort(
      (a, b) => b.streakDays - a.streakDays || byCodeUnit(a.habit, b.habit)
    ),
  };
}

export const trellisProducer: Producer<TrellisPush> = {
  id: 'trellis',
  source: 'shelf',
  schema: trellisPushSchema,
  snapshotSchema: shelfSnapshotSchema,
  project: projectShelf,
  tokens: (env) => [env.PUSH_TOKEN_TRELLIS, env.PUSH_TOKEN_TRELLIS_NEXT],
  signingKeys: (env) => [env.PUSH_HMAC_TRELLIS, env.PUSH_HMAC_TRELLIS_NEXT],
};
