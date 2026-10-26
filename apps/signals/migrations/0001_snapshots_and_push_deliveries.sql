-- Latest snapshot per source (ADR 0010). Times in *_at TEXT columns are UTC RFC 3339 with
-- milliseconds (`Date.prototype.toISOString`), so they compare correctly as strings; times
-- in INTEGER columns are Unix milliseconds.
CREATE TABLE snapshots (
  source TEXT PRIMARY KEY,
  -- Normalized snapshot JSON, null until the source has succeeded once.
  json TEXT,
  -- When the data was true: the fetch time for pulled sources, the producer's `sentAt` for
  -- pushed ones. Served as `fetchedAt`; `stale` is computed from it.
  fetched_at TEXT,
  -- When signals last stored a snapshot for the source.
  last_success_at TEXT,
  last_error_code TEXT,
  -- Pull sources: when the cron last tried the source.
  last_attempt_at INTEGER,
  -- Push sources: receipt time and delivery id of the snapshot stored now.
  last_push_at INTEGER,
  last_delivery_id TEXT
) STRICT;

-- Push deliveries seen in the last 7 days: the replay and idempotency check (ADR 0011).
CREATE TABLE push_deliveries (
  producer TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  body_sha256 TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  PRIMARY KEY (producer, delivery_id)
) STRICT;

CREATE INDEX push_deliveries_received_at ON push_deliveries (received_at);
