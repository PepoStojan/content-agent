-- Architecture V1 — projects and project membership.
-- project_members replaces the earlier assigned_user_ids[] draft —
-- a proper join table for RLS-friendly Content Writer scoping.

create table projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  content_type content_type not null,
  primary_topic text,
  target_query text,
  market text,
  business_profile_id uuid references business_profiles(id),
  brand_profile_id uuid references brand_profiles(id),
  instructions text,
  status project_status not null default 'draft',
  current_research_package_id uuid, -- FK added after research_packages exists
  current_website_dataset_id uuid,  -- FK added after website_datasets exists
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_projects_updated_at before update on projects
  for each row execute function set_updated_at();
create index projects_organization_id_idx on projects(organization_id);
create index projects_status_idx on projects(status);

create table project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  added_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);
create index project_members_project_id_idx on project_members(project_id);
create index project_members_user_id_idx on project_members(user_id);
