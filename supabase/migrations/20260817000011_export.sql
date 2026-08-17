-- Architecture V1 — Export. Pins the exact Brief/Blueprint/Content
-- versions exported, for the same reproducibility reason as QA.
-- Formats frozen to Markdown/HTML/DOCX/Structured JSON, plain
-- structured output in V1 (no branded templates yet).

create table exports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  generation_run_id uuid references generation_runs(id),
  brief_version_id uuid references brief_versions(id),
  blueprint_version_id uuid references blueprint_versions(id),
  formats jsonb not null default '[]',
  status export_status not null default 'idle',
  requested_by uuid references auth.users(id),
  requested_at timestamptz,
  completed_at timestamptz
);
create index exports_project_id_idx on exports(project_id);

create table export_content_versions (
  id uuid primary key default gen_random_uuid(),
  export_id uuid not null references exports(id) on delete cascade,
  content_version_id uuid not null references content_versions(id)
);
create index export_content_versions_export_id_idx on export_content_versions(export_id);

create table export_files (
  id uuid primary key default gen_random_uuid(),
  export_id uuid not null references exports(id) on delete cascade,
  format text not null,
  file_name text not null,
  storage_path text not null,
  created_at timestamptz not null default now()
);
create index export_files_export_id_idx on export_files(export_id);
