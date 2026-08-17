-- Architecture V1 — Website Knowledge (sitemap + Screaming Frog
-- internal_all.csv) and the internal linking engine's candidate pool.

create table website_datasets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  sitemap_project_file_id uuid references project_files(id),
  screaming_frog_project_file_id uuid references project_files(id),
  status upload_status not null default 'idle',
  parsed_summary jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_website_datasets_updated_at before update on website_datasets
  for each row execute function set_updated_at();
create index website_datasets_project_id_idx on website_datasets(project_id);

alter table projects
  add constraint projects_current_website_dataset_id_fkey
  foreign key (current_website_dataset_id) references website_datasets(id);

create table website_urls (
  id uuid primary key default gen_random_uuid(),
  website_dataset_id uuid not null references website_datasets(id) on delete cascade,
  url text not null,
  indexable boolean,
  status_code integer,
  title text,
  h1 text,
  metadata jsonb,
  source website_url_source not null,
  created_at timestamptz not null default now()
);
create index website_urls_website_dataset_id_idx on website_urls(website_dataset_id);
create index website_urls_url_idx on website_urls(url);

-- Engineering spec §8: suggest, don't force. reason/confidence make
-- each suggestion explainable; keep/change/remove is a UI concern on
-- top of this table, not a separate schema.
create table internal_link_candidates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  website_dataset_id uuid references website_datasets(id),
  url text not null,
  anchor_text_suggestion text,
  reason text,
  confidence numeric,
  created_at timestamptz not null default now()
);
create index internal_link_candidates_project_id_idx on internal_link_candidates(project_id);
