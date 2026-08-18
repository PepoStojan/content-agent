-- Phase 3 — Project/Workspace shell RLS + private Storage bucket.
-- Additive only: does not modify any of the 13 approved Phase 0
-- migrations or the Phase 2 migration.

-- --- Helper: can the current user access this project at all? ---------
-- Team Lead / SEO Manager: any project in their org.
-- Content Writer: only projects they're an explicit member of.

create or replace function can_access_project(target_project_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from projects p
    where p.id = target_project_id
      and p.organization_id = current_organization_id()
      and (
        current_app_role() in ('team_lead', 'seo_manager')
        or exists (
          select 1 from project_members pm
          where pm.project_id = p.id and pm.user_id = auth.uid()
        )
      )
  )
$$;

-- --- projects -----------------------------------------------------------
-- Write access (create/update projects) is Team Lead/SEO Manager only,
-- matching the agreed permission matrix. No delete policy in Phase 3 —
-- project deletion isn't part of this phase's scope.

create policy projects_select_accessible on projects
  for select
  using (can_access_project(id));

create policy projects_insert_managers on projects
  for insert
  with check (
    organization_id = current_organization_id()
    and current_app_role() in ('team_lead', 'seo_manager')
  );

create policy projects_update_managers on projects
  for update
  using (
    organization_id = current_organization_id()
    and current_app_role() in ('team_lead', 'seo_manager')
  )
  with check (
    organization_id = current_organization_id()
    and current_app_role() in ('team_lead', 'seo_manager')
  );

-- --- project_members ------------------------------------------------------

create policy project_members_select_accessible on project_members
  for select
  using (can_access_project(project_id));

create policy project_members_insert_managers on project_members
  for insert
  with check (
    can_access_project(project_id)
    and current_app_role() in ('team_lead', 'seo_manager')
  );

-- --- project_files ----------------------------------------------------------

create policy project_files_select_accessible on project_files
  for select
  using (can_access_project(project_id));

create policy project_files_insert_managers on project_files
  for insert
  with check (
    can_access_project(project_id)
    and current_app_role() in ('team_lead', 'seo_manager')
  );

create policy project_files_update_managers on project_files
  for update
  using (can_access_project(project_id) and current_app_role() in ('team_lead', 'seo_manager'))
  with check (can_access_project(project_id) and current_app_role() in ('team_lead', 'seo_manager'));

-- --- research_packages ----------------------------------------------------

create policy research_packages_select_accessible on research_packages
  for select
  using (can_access_project(project_id));

create policy research_packages_insert_managers on research_packages
  for insert
  with check (
    can_access_project(project_id)
    and current_app_role() in ('team_lead', 'seo_manager')
  );

create policy research_packages_update_managers on research_packages
  for update
  using (can_access_project(project_id) and current_app_role() in ('team_lead', 'seo_manager'))
  with check (can_access_project(project_id) and current_app_role() in ('team_lead', 'seo_manager'));

-- --- research_sources (scoped via research_packages.project_id) -----------

create policy research_sources_select_accessible on research_sources
  for select
  using (
    exists (
      select 1 from research_packages rp
      where rp.id = research_package_id and can_access_project(rp.project_id)
    )
  );

create policy research_sources_insert_managers on research_sources
  for insert
  with check (
    exists (
      select 1 from research_packages rp
      where rp.id = research_package_id
        and can_access_project(rp.project_id)
        and current_app_role() in ('team_lead', 'seo_manager')
    )
  );

-- --- website_datasets -------------------------------------------------------

create policy website_datasets_select_accessible on website_datasets
  for select
  using (can_access_project(project_id));

create policy website_datasets_insert_managers on website_datasets
  for insert
  with check (
    can_access_project(project_id)
    and current_app_role() in ('team_lead', 'seo_manager')
  );

create policy website_datasets_update_managers on website_datasets
  for update
  using (can_access_project(project_id) and current_app_role() in ('team_lead', 'seo_manager'))
  with check (can_access_project(project_id) and current_app_role() in ('team_lead', 'seo_manager'));

-- --- website_urls (scoped via website_datasets.project_id) -----------------

create policy website_urls_select_accessible on website_urls
  for select
  using (
    exists (
      select 1 from website_datasets wd
      where wd.id = website_dataset_id and can_access_project(wd.project_id)
    )
  );

create policy website_urls_insert_managers on website_urls
  for insert
  with check (
    exists (
      select 1 from website_datasets wd
      where wd.id = website_dataset_id
        and can_access_project(wd.project_id)
        and current_app_role() in ('team_lead', 'seo_manager')
    )
  );

-- --- internal_link_candidates ----------------------------------------------

create policy internal_link_candidates_select_accessible on internal_link_candidates
  for select
  using (can_access_project(project_id));

create policy internal_link_candidates_insert_managers on internal_link_candidates
  for insert
  with check (
    can_access_project(project_id)
    and current_app_role() in ('team_lead', 'seo_manager')
  );

-- --- Private Storage bucket for project files -------------------------------
-- Path convention: {project_id}/{research|website}/{filename}. Private —
-- no public read; access only via signed URLs generated server-side
-- through these same policies.

insert into storage.buckets (id, name, public)
values ('project-files', 'project-files', false)
on conflict (id) do nothing;

create policy project_files_storage_select on storage.objects
  for select
  using (
    bucket_id = 'project-files'
    and can_access_project((storage.foldername(name))[1]::uuid)
  );

create policy project_files_storage_insert on storage.objects
  for insert
  with check (
    bucket_id = 'project-files'
    and current_app_role() in ('team_lead', 'seo_manager')
    and can_access_project((storage.foldername(name))[1]::uuid)
  );
