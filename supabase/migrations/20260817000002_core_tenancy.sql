-- Architecture V1 — organizations, users, reusable profiles, settings.
-- V1 is a single internal organization with multiple users; the
-- organization_id column exists on every tenant-scoped table so
-- multi-tenancy is a later filter, not a later migration.

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_organizations_updated_at before update on organizations
  for each row execute function set_updated_at();

-- One row per auth.users user. auth_provider defaults to 'google' per
-- the V1 auth decision; the auth layer itself stays provider-agnostic
-- (Supabase Auth), this column is informational.
create table profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  role user_role not null,
  auth_provider text not null default 'google',
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_profiles_updated_at before update on profiles
  for each row execute function set_updated_at();
create index profiles_organization_id_idx on profiles(organization_id);

create table business_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  company text not null,
  market text,
  audience text,
  services text,
  conversion_goal text,
  preferred_cta text,
  prohibited_claims text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_business_profiles_updated_at before update on business_profiles
  for each row execute function set_updated_at();
create index business_profiles_organization_id_idx on business_profiles(organization_id);

create table brand_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  tone text,
  reading_level text,
  spelling_locale text,
  sentence_preferences text,
  formatting_preferences text,
  preferred_terminology text,
  forbidden_phrases text[] not null default '{}',
  em_dash_forbidden boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_brand_profiles_updated_at before update on brand_profiles
  for each row execute function set_updated_at();
create index brand_profiles_organization_id_idx on brand_profiles(organization_id);

-- Single source of truth for strict_approval_gate — read by both the
-- tab-locking logic and the Settings toggle. Global in V1 (one row
-- per organization, and V1 has exactly one organization).
create table settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references organizations(id) on delete cascade,
  strict_approval_gate boolean not null default true,
  structured_json_export_enabled boolean not null default true,
  ai_model_id text,
  file_size_limits jsonb not null default '{"csv_mb":25,"markdown_mb":10,"docx_mb":25,"xml_mb":25}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_settings_updated_at before update on settings
  for each row execute function set_updated_at();
