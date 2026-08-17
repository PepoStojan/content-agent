-- Architecture V1 — Content Blueprint, versioned, same head+version
-- pattern as Brief. Blueprint regeneration creates a new
-- blueprint_versions row with its own fresh blueprint_nodes; the
-- previous version, its nodes, and anything built on them (content,
-- QA, exports) stay fully intact — content is never inherited across
-- blueprint versions (no FK path allows it, by construction below).

create table content_blueprints (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references projects(id) on delete cascade,
  current_version_id uuid, -- FK added after blueprint_versions exists
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_content_blueprints_updated_at before update on content_blueprints
  for each row execute function set_updated_at();

create table blueprint_versions (
  id uuid primary key default gen_random_uuid(),
  content_blueprint_id uuid not null references content_blueprints(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  version integer not null,
  status artifact_version_status not null default 'draft',
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  generated_at timestamptz,
  generation_run_id uuid references generation_runs(id),
  model_id text,
  prompt_version text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (project_id, version)
);
create index blueprint_versions_content_blueprint_id_idx on blueprint_versions(content_blueprint_id);
create index blueprint_versions_project_id_idx on blueprint_versions(project_id);

alter table content_blueprints
  add constraint content_blueprints_current_version_id_fkey
  foreign key (current_version_id) references blueprint_versions(id);

-- Engineering spec §12: title/level, purpose, research support, unique
-- contribution, entities, internal links, evidence needs, writing notes.
create table blueprint_nodes (
  id uuid primary key default gen_random_uuid(),
  blueprint_version_id uuid not null references blueprint_versions(id) on delete cascade,
  parent_id uuid references blueprint_nodes(id) on delete cascade,
  level integer not null,
  position integer not null,
  title text not null,
  goal text,
  research_support text,
  unique_contribution text,
  entities jsonb not null default '[]',
  internal_link_targets jsonb not null default '[]',
  evidence_requirement text,
  writing_notes text,
  target_word_count integer,
  created_at timestamptz not null default now()
);
create index blueprint_nodes_blueprint_version_id_idx on blueprint_nodes(blueprint_version_id);
create index blueprint_nodes_parent_id_idx on blueprint_nodes(parent_id);
