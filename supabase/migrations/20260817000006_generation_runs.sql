-- Architecture V1 — generation_runs: the single persistent record of
-- every async unit of work (parsing, Brief/Blueprint/Content
-- generation, QA, Export), orchestrated by Vercel Workflow.
-- content_generate: one row per blueprint_node/section (approved).

create table generation_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  type generation_run_type not null,
  status generation_run_status not null default 'queued',
  progress numeric,
  input_ref jsonb,
  output_ref jsonb,
  error jsonb,
  workflow_run_id text,
  model_id text,
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_generation_runs_updated_at before update on generation_runs
  for each row execute function set_updated_at();
create index generation_runs_project_id_idx on generation_runs(project_id);
create index generation_runs_type_status_idx on generation_runs(type, status);
