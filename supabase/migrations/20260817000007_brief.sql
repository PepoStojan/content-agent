-- Architecture V1 — Strategy Brief, versioned. content_briefs is the
-- per-project head record (current_version_id points at the active,
-- immutable brief_versions row). Regeneration/edits always insert a
-- new version; nothing here is ever overwritten in place.
-- Fields match engineering spec §10 exactly.

create table content_briefs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references projects(id) on delete cascade,
  current_version_id uuid, -- FK added after brief_versions exists
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_content_briefs_updated_at before update on content_briefs
  for each row execute function set_updated_at();

create table brief_versions (
  id uuid primary key default gen_random_uuid(),
  content_brief_id uuid not null references content_briefs(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  version integer not null,
  research_package_id uuid references research_packages(id),

  search_intent_label text,
  search_intent_confidence numeric,
  search_intent_rationale text,
  target_audience text,
  content_objective text,
  secondary_topics jsonb not null default '[]',
  serp_interpretation text,
  common_competitor_expectations text,
  unique_value text,
  title text,
  h1 text,
  meta_description text,
  entities_concepts jsonb not null default '[]',
  questions jsonb not null default '[]',
  evidence_requirements jsonb not null default '[]',
  things_to_avoid jsonb not null default '[]',
  business_brand_alignment text,
  research_limitations text,

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
create index brief_versions_content_brief_id_idx on brief_versions(content_brief_id);
create index brief_versions_project_id_idx on brief_versions(project_id);

alter table content_briefs
  add constraint content_briefs_current_version_id_fkey
  foreign key (current_version_id) references brief_versions(id);

create table brief_topics (
  id uuid primary key default gen_random_uuid(),
  brief_version_id uuid not null references brief_versions(id) on delete cascade,
  label text not null
);
create index brief_topics_brief_version_id_idx on brief_topics(brief_version_id);

create table brief_internal_links (
  id uuid primary key default gen_random_uuid(),
  brief_version_id uuid not null references brief_versions(id) on delete cascade,
  anchor_text text not null,
  target_url text not null
);
create index brief_internal_links_brief_version_id_idx on brief_internal_links(brief_version_id);
