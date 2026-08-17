-- Architecture V1 — Content, versioned per section. content_documents
-- is the per-blueprint_node head record; content_versions is the
-- immutable history (every manual edit and every regenerate inserts a
-- new version, approve toggles status on the current version only).
-- V1 stores body as Markdown/plain text (not TipTap/ProseMirror JSON) —
-- keep this column swappable for a future rich-text format.

create table content_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  blueprint_node_id uuid not null unique references blueprint_nodes(id) on delete cascade,
  current_version_id uuid, -- FK added after content_versions exists
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_content_documents_updated_at before update on content_documents
  for each row execute function set_updated_at();
create index content_documents_project_id_idx on content_documents(project_id);

create table content_versions (
  id uuid primary key default gen_random_uuid(),
  content_document_id uuid not null references content_documents(id) on delete cascade,
  blueprint_node_id uuid not null references blueprint_nodes(id),
  project_id uuid not null references projects(id) on delete cascade,
  version integer not null,
  body text not null default '',
  status content_version_status not null default 'ai_generated',
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  generation_run_id uuid references generation_runs(id),
  model_id text,
  prompt_version text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (content_document_id, version)
);
create index content_versions_content_document_id_idx on content_versions(content_document_id);
create index content_versions_project_id_idx on content_versions(project_id);

alter table content_documents
  add constraint content_documents_current_version_id_fkey
  foreign key (current_version_id) references content_versions(id);
