-- A pull spread over several cron invocations (ADR 0030): what its earlier invocations read,
-- so the next one carries on, after a restart too. One row per source, replaced when a new
-- pull starts and deleted when the snapshot is complete. Only this table is added, so the
-- Worker version before it runs unchanged against it (ADR 0010).
CREATE TABLE pull_progress (
  source TEXT PRIMARY KEY,
  -- The date in Rabat the pull describes, `YYYY-MM-DD`.
  described_date TEXT NOT NULL,
  -- Invocations that have saved a part; a save must name the step it read, so two
  -- overlapping invocations cannot both add theirs.
  step INTEGER NOT NULL,
  -- The parts read so far, small and bounded (src/adapters/pull/listening-history.ts).
  json TEXT NOT NULL
) STRICT;
