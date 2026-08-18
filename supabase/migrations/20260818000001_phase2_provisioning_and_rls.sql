-- Phase 2 — provisioning + RLS policies for organizations, profiles,
-- business_profiles, brand_profiles. Additive only: does not modify
-- any of the 13 approved Phase 0 migrations.
--
-- V1 provisioning model (manual seed, per Phase 2 decision #1): a
-- single organizations row, and profiles rows created by hand for
-- known users. No self-service signup provisioning in V1 — a user
-- without a profiles row sees a "Pending access" state and cannot
-- enter the workspace (enforced in application middleware).

-- --- Helper functions, used inside RLS policies ---------------------

create or replace function current_organization_id()
returns uuid
language sql
stable
as $$
  select organization_id from profiles where user_id = auth.uid()
$$;

create or replace function current_app_role()
returns user_role
language sql
stable
as $$
  select role from profiles where user_id = auth.uid()
$$;

-- --- organizations ----------------------------------------------------

create policy organizations_select_own on organizations
  for select
  using (id = current_organization_id());

-- --- profiles ---------------------------------------------------------
-- Self-select only. No write policies for the authenticated/anon
-- roles in V1 — profile rows are provisioned manually (see seed
-- below), never created by the app itself.

create policy profiles_select_own on profiles
  for select
  using (user_id = auth.uid());

-- --- business_profiles -------------------------------------------------
-- Read: any member of the org (Team Lead, SEO Manager, Content Writer).
-- Write: Team Lead and SEO Manager only.

create policy business_profiles_select_org on business_profiles
  for select
  using (organization_id = current_organization_id());

create policy business_profiles_insert_managers on business_profiles
  for insert
  with check (
    organization_id = current_organization_id()
    and current_app_role() in ('team_lead', 'seo_manager')
  );

create policy business_profiles_update_managers on business_profiles
  for update
  using (
    organization_id = current_organization_id()
    and current_app_role() in ('team_lead', 'seo_manager')
  )
  with check (
    organization_id = current_organization_id()
    and current_app_role() in ('team_lead', 'seo_manager')
  );

create policy business_profiles_delete_managers on business_profiles
  for delete
  using (
    organization_id = current_organization_id()
    and current_app_role() in ('team_lead', 'seo_manager')
  );

-- --- brand_profiles -----------------------------------------------------
-- Same read/write shape as business_profiles.

create policy brand_profiles_select_org on brand_profiles
  for select
  using (organization_id = current_organization_id());

create policy brand_profiles_insert_managers on brand_profiles
  for insert
  with check (
    organization_id = current_organization_id()
    and current_app_role() in ('team_lead', 'seo_manager')
  );

create policy brand_profiles_update_managers on brand_profiles
  for update
  using (
    organization_id = current_organization_id()
    and current_app_role() in ('team_lead', 'seo_manager')
  )
  with check (
    organization_id = current_organization_id()
    and current_app_role() in ('team_lead', 'seo_manager')
  );

create policy brand_profiles_delete_managers on brand_profiles
  for delete
  using (
    organization_id = current_organization_id()
    and current_app_role() in ('team_lead', 'seo_manager')
  );

-- --- V1 manual seed -----------------------------------------------------
-- Idempotent: safe to re-run. Single organization; one known user
-- provisioned as team_lead. Additional users are provisioned the same
-- manual way (insert into profiles) as they're onboarded.

insert into organizations (name)
select 'Default Organization'
where not exists (select 1 from organizations);

insert into profiles (user_id, organization_id, role)
select u.id, o.id, 'team_lead'
from auth.users u
cross join (select id from organizations limit 1) o
where u.email = 'stojan.peposki@gmail.com'
on conflict (user_id) do nothing;
