-- Phase 4.4 infrastructure — Blueprint RLS policies.
-- content_blueprints, blueprint_versions, blueprint_nodes have had
-- RLS enabled since Phase 0 (migration 13) with zero policies (fully
-- locked) — the same "RLS enabled, zero policies" gap already fixed
-- for the Brief tables in Phase 4.3 (20260823000001), now closed here
-- for Blueprint before any generation code is written against these
-- tables.
--
-- Reuses the existing SECURITY DEFINER helpers only
-- (can_access_project, current_app_role) — no new helper function, so
-- no new recursion risk (see migrations 16/17 for that bug class).
--
-- Permission matrix, matching content_briefs/brief_versions exactly:
--   SELECT: any user who can access the project (team_lead/seo_manager
--     org-wide, content_writer only if an explicit project_members row).
--   INSERT/UPDATE: team_lead/seo_manager only.
--
-- Blueprint generation itself is not implemented in this migration —
-- these policies only make the tables usable once it is.

-- --- content_blueprints -------------------------------------------------
-- Head row. UPDATE is required for the same reason as content_briefs:
-- the artifact-persist sequence flips content_blueprints.current_version_id
-- as its last step, on an already-existing head row.

create policy content_blueprints_select_accessible on content_blueprints
  for select
  using (can_access_project(project_id));

create policy content_blueprints_insert_managers on content_blueprints
  for insert
  with check (
    can_access_project(project_id)
    and current_app_role() in ('team_lead', 'seo_manager')
  );

create policy content_blueprints_update_managers on content_blueprints
  for update
  using (can_access_project(project_id) and current_app_role() in ('team_lead', 'seo_manager'))
  with check (can_access_project(project_id) and current_app_role() in ('team_lead', 'seo_manager'));

-- --- blueprint_versions --------------------------------------------------
-- project_id exists directly on this table. UPDATE is required for
-- the approve action (status='approved', approved_by, approved_at)
-- and the locked Request-changes representation (project-status-level,
-- per BD2/§10 of the Phase 4.4 plan — blueprint_versions itself is
-- never touched by Request changes, only by Approve). The
-- brief_version_id immutability trigger (20260824000001) already
-- guards this same UPDATE path at the column level, independent of
-- RLS — RLS controls who may update the row at all, the trigger
-- controls which columns a permitted update may actually change.

create policy blueprint_versions_select_accessible on blueprint_versions
  for select
  using (can_access_project(project_id));

create policy blueprint_versions_insert_managers on blueprint_versions
  for insert
  with check (
    can_access_project(project_id)
    and current_app_role() in ('team_lead', 'seo_manager')
  );

create policy blueprint_versions_update_managers on blueprint_versions
  for update
  using (can_access_project(project_id) and current_app_role() in ('team_lead', 'seo_manager'))
  with check (can_access_project(project_id) and current_app_role() in ('team_lead', 'seo_manager'));

-- --- blueprint_nodes (scoped via blueprint_versions.project_id) -----------
-- AI-generated, insert-only at generation time — same select+insert-only
-- shape already used for brief_topics/brief_internal_links. No update
-- policy yet: manual per-node editing (Phase 4.4 plan §11's explicitly
-- unresolved question) is not implemented in this migration; an update
-- policy can be added in its own migration once that behavior is
-- actually designed, rather than opened prematurely here.

create policy blueprint_nodes_select_accessible on blueprint_nodes
  for select
  using (
    exists (
      select 1 from blueprint_versions bv
      where bv.id = blueprint_version_id and can_access_project(bv.project_id)
    )
  );

create policy blueprint_nodes_insert_managers on blueprint_nodes
  for insert
  with check (
    exists (
      select 1 from blueprint_versions bv
      where bv.id = blueprint_version_id
        and can_access_project(bv.project_id)
        and current_app_role() in ('team_lead', 'seo_manager')
    )
  );
