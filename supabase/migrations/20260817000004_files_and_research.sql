-- Architecture V1 — generic upload registry + Research Package
-- normalization. research_sources.type enum values match engineering
-- spec §6 exactly. Do not fabricate parser assumptions here — this is
-- schema only, ingestion logic comes later per format sample.

create table project_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  file_type project_file_type not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint not null,
  storage_path text not null,
  uploaded_by uuid references auth.users(id),
  validation_status file_validation_status not null default 'pending',
  validation_error text,
  created_at timestamptz not null default now()
);
create index project_files_project_id_idx on project_files(project_id);

create table research_packages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  project_file_id uuid references project_files(id),
  status upload_status not null default 'idle',
  parsed_summary jsonb,
  error_message text,
  -- Topic precedence rule: project/user inputs are authoritative.
  -- Research metadata is evidence only. A conflict is recorded here,
  -- never used to silently overwrite projects.primary_topic/target_query.
  topic_conflict_flag boolean not null default false,
  topic_conflict_details jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_research_packages_updated_at before update on research_packages
  for each row execute function set_updated_at();
create index research_packages_project_id_idx on research_packages(project_id);

alter table projects
  add constraint projects_current_research_package_id_fkey
  foreign key (current_research_package_id) references research_packages(id);

create table research_sources (
  id uuid primary key default gen_random_uuid(),
  research_package_id uuid not null references research_packages(id) on delete cascade,
  type research_source_type not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index research_sources_research_package_id_idx on research_sources(research_package_id);
create index research_sources_type_idx on research_sources(type);
