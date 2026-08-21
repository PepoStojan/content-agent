-- Phase 4.7 — real export server action (EXPORT-06).
-- `exports` had no place to record a real failure's cause — every
-- other stage in this pipeline has one (`generation_runs.error`), but
-- Export deliberately does not use the Generation Engine (ED4), so it
-- needs its own. Same shape convention as `generation_runs.error`
-- (`{ type, message, retryable? }`) for consistency, not a new
-- pattern. Nullable: only set when `status = 'failed'`.

alter table exports
  add column error jsonb;
