-- Daily history (ADR 0038): one row per series per calendar day, kept for good. A series' days
-- are in its own zone (shipping-activity: UTC; llm-usage: Africa/Casablanca). Rows are only
-- inserted or replaced, never deleted. Only this table and a nullable column are added, so the
-- Worker version before it runs unchanged against it (ADR 0010).
CREATE TABLE daily (
  -- The source that writes the series.
  source TEXT NOT NULL,
  -- `YYYY-MM-DD` in the series' zone.
  day TEXT NOT NULL,
  -- The day's values as the series' stored-day schema in contracts has them.
  json TEXT NOT NULL,
  -- When the report that last changed the row was true: repo-pulse's `generatedAt`, or the
  -- push's `sentAt`. UTC with milliseconds, so it compares as a string.
  fetched_at TEXT NOT NULL,
  -- When signals last changed the row.
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source, day)
) STRICT, WITHOUT ROWID;

-- A dated pull's write (ADR 0038): a random id set with each snapshot write that brings days.
-- The batch writes its days only if the snapshot row then carries its id, so days are kept only
-- with the very answer whose snapshot was stored, and a write that read an older state than the
-- one stored is dropped whole. Null for every other source.
ALTER TABLE snapshots ADD COLUMN write_id TEXT;
