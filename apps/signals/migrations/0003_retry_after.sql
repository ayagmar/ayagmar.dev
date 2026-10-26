-- When an upstream refused with a Retry-After header, the time before which the cron must not
-- pull that source again (ADR 0030), kept in D1 so a restarted isolate honours it too. Null
-- otherwise. Only a nullable column is added, so the Worker version before it runs unchanged
-- against it (ADR 0010).
ALTER TABLE snapshots ADD COLUMN retry_after_at INTEGER;
