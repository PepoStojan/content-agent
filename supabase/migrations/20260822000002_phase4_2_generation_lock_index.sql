-- Phase 4.2 — Generation Lock (D2), split into its own migration.
-- Must run after 20260822000001 has committed: Postgres disallows
-- using a newly-added enum value inside an index predicate within the
-- same transaction it was added in (SQLSTATE 55P04).
--
-- One active Generation per (project, type) at a time. "Active" spans
-- every non-terminal status, including the two recovery-phase states
-- — a run sitting in provider_completed/artifact_persisted is still
-- in flight, not done, and must still block a duplicate start.
-- Scoped to project+type only for this skeleton; content_generate's
-- one-job-per-section need (a compound key including blueprint_node_id)
-- is deferred until content generation is actually implemented, per
-- the architecture doc's own note not to build that ahead of need.

create unique index generation_runs_one_active_per_project_type
  on generation_runs (project_id, type)
  where status in ('queued', 'running', 'provider_completed', 'artifact_persisted');
