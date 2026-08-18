-- Phase 4.1 — Generation infrastructure: pipeline state machine on
-- projects, an execution log (generation_events), and RLS. No AI
-- generation wired yet — infrastructure only.
--
-- Deliberately reuses existing objects instead of adding new ones:
-- - generation_state is a NEW column on the existing `projects` table
--   (not a new table) — projects_update_managers (Phase 3) already
--   covers writes to it; RLS is row-level, not column-level.
-- - generation_events' RLS reuses current_organization_id(),
--   current_app_role(), and can_access_project() — all already
--   SECURITY DEFINER with a fixed search_path from the Phase 3 fix.
--   No new helper function is written here, so the Phase 3 RLS
--   recursion bug (a non-SECURITY-DEFINER function querying the same
--   table it protects) has no way to repeat: there is nothing new to
--   get wrong.

create type generation_state as enum (
  'draft',
  'strategy_pending', 'strategy_generating', 'strategy_completed',
  'blueprint_pending', 'blueprint_generating', 'blueprint_completed',
  'content_pending', 'content_generating', 'content_completed',
  'qa_pending', 'qa_running', 'qa_completed',
  'export_pending', 'export_completed',
  'failed'
);

alter table projects
  add column generation_state generation_state not null default 'draft';

-- --- generation_events -----------------------------------------------
-- A lightweight execution log distinct from generation_runs (which
-- already exists and is the durable per-job record with model/cost
-- fields for actual AI calls, still unused as of Phase 3). This table
-- is the state-machine's timeline: one row per stage
-- start/completion/failure event, independent of whether that stage
-- ends up calling an LLM.

create type generation_stage as enum ('strategy', 'blueprint', 'content', 'qa', 'export');

create table generation_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  stage generation_stage not null,
  event text not null,
  status generation_run_status not null,
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms integer,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index generation_events_project_id_idx on generation_events(project_id);
create index generation_events_stage_idx on generation_events(stage);

alter table generation_events enable row level security;

create policy generation_events_select_accessible on generation_events
  for select
  using (can_access_project(project_id));

create policy generation_events_insert_managers on generation_events
  for insert
  with check (
    can_access_project(project_id)
    and current_app_role() in ('team_lead', 'seo_manager')
  );
