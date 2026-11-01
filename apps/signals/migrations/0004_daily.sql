-- Daily history (ADR 0038): one row per series per calendar day, kept for good. A series' days
-- are in its own zone (shipping-activity: UTC; llm-usage: Africa/Casablanca). Rows are only
-- inserted or replaced, never deleted. Only this table is added, so the Worker version before
-- it runs unchanged against it (ADR 0010).
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
