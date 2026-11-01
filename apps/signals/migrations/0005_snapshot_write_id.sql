-- A dated pull's write (ADR 0038): a random id set with each snapshot write that brings days.
-- The batch writes its days only if the snapshot row then carries its id, so days are kept only
-- with the very answer whose snapshot was stored, and a write that read an older state than the
-- one stored is dropped whole. Null for every other source. A nullable column only, so the
-- Worker version before it runs unchanged against it (ADR 0010).
ALTER TABLE snapshots ADD COLUMN write_id TEXT;
