-- Phase 4.2 — Generation Engine schema. Implements exactly D1–D7 from
-- docs/architecture/phase-4-2-generation-engine.md. No speculative
-- columns, no new tables — generation_runs (Phase 0, unused until
-- now) gains the fields the locked architecture requires.

-- --- Recovery states (D1, D5: queued → running → provider_completed
-- → artifact_persisted → completed) ---------------------------------
-- Safe to ADD VALUE here: generation_runs has zero rows, and neither
-- new value is referenced anywhere in this same migration, so the
-- "unsafe use of new enum value in the same transaction" restriction
-- never applies.
alter type generation_run_status add value 'provider_completed' after 'running';
alter type generation_run_status add value 'artifact_persisted' after 'provider_completed';
-- "succeeded" never shipped in any application code (generation_runs
-- has been unused since Phase 0) — renaming, not introducing a
-- parallel value, per D7's "completed" terminology.
alter type generation_run_status rename value 'succeeded' to 'completed';

-- --- Rename existing columns to match D7's canonical field names ----
alter table generation_runs rename column model_id to model;
alter table generation_runs rename column finished_at to completed_at;

-- --- Generation Telemetry (D7) ---------------------------------------
alter table generation_runs
  add column provider text,
  add column provider_request_id text,
  add column input_tokens integer,
  add column output_tokens integer,
  add column total_tokens integer,
  add column estimated_cost_usd numeric,
  add column provider_completed_at timestamptz,
  add column artifact_persisted_at timestamptz,
  add column duration_ms integer,
  add column finish_reason text,
  add column attempt_number integer not null default 1,
  add column retry_of_generation_run uuid references generation_runs(id),
  add column metadata jsonb not null default '{}';

create index generation_runs_retry_of_idx on generation_runs(retry_of_generation_run);

-- Generation Lock (D2) is a separate migration (20260822000002) —
-- Postgres refuses to use a newly-added enum value (provider_completed
-- / artifact_persisted, added above) inside an index predicate within
-- the same transaction it was added in (SQLSTATE 55P04), even though
-- that restriction doesn't apply to ordinary DML. Splitting the file
-- is required, not stylistic.

-- --- RLS ----------------------------------------------------------------
-- generation_runs has had RLS enabled since Phase 0 with zero
-- policies (fully locked). Reuses the existing SECURITY DEFINER
-- helpers only — no new function, so no new recursion risk.

create policy generation_runs_select_accessible on generation_runs
  for select
  using (can_access_project(project_id));

create policy generation_runs_insert_managers on generation_runs
  for insert
  with check (
    can_access_project(project_id)
    and current_app_role() in ('team_lead', 'seo_manager')
  );

create policy generation_runs_update_managers on generation_runs
  for update
  using (can_access_project(project_id) and current_app_role() in ('team_lead', 'seo_manager'))
  with check (can_access_project(project_id) and current_app_role() in ('team_lead', 'seo_manager'));
