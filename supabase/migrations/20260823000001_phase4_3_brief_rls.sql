-- Phase 4.3 — Strategy Brief RLS policies. content_briefs, brief_versions,
-- brief_topics, brief_internal_links have had RLS enabled since Phase 0
-- (migration 13) with zero policies (fully locked) — the same trap that
-- caused real bugs on `projects` and `generation_runs` earlier in this
-- project. This migration is additive only and does not touch any
-- previously-applied migration.
--
-- Reuses the existing SECURITY DEFINER helpers only
-- (can_access_project, current_app_role) — no new helper function,
-- so no new recursion risk (see migrations 16/17 for that bug class).
--
-- Permission matrix, matching the rest of the project:
--   SELECT: any user who can access the project (team_lead/seo_manager
--     org-wide, content_writer only if an explicit project_members row).
--   INSERT/UPDATE: team_lead/seo_manager only. Content Writer has
--     read-only access to Briefs, consistent with the existing
--     generation_runs/projects/research_packages policies.

-- --- content_briefs -------------------------------------------------------
-- Head row. UPDATE is required here (not just INSERT) because the
-- Phase 4.3 plan's artifact-persist sequence (§3) flips
-- content_briefs.current_version_id as its last step, on an
-- already-existing head row.

create policy content_briefs_select_accessible on content_briefs
  for select
  using (can_access_project(project_id));

create policy content_briefs_insert_managers on content_briefs
  for insert
  with check (
    can_access_project(project_id)
    and current_app_role() in ('team_lead', 'seo_manager')
  );

create policy content_briefs_update_managers on content_briefs
  for update
  using (can_access_project(project_id) and current_app_role() in ('team_lead', 'seo_manager'))
  with check (can_access_project(project_id) and current_app_role() in ('team_lead', 'seo_manager'));

-- --- brief_versions --------------------------------------------------------
-- project_id exists directly on this table. UPDATE is required for the
-- approve action (status='approved', approved_by, approved_at) and for
-- the locked Request-changes decision (status -> 'needs_revision').
-- Existing version rows are otherwise never mutated by application code
-- (append-only versioning) — RLS permits UPDATE at the row-security
-- layer, in-app logic is what keeps historical fields immutable.

create policy brief_versions_select_accessible on brief_versions
  for select
  using (can_access_project(project_id));

create policy brief_versions_insert_managers on brief_versions
  for insert
  with check (
    can_access_project(project_id)
    and current_app_role() in ('team_lead', 'seo_manager')
  );

create policy brief_versions_update_managers on brief_versions
  for update
  using (can_access_project(project_id) and current_app_role() in ('team_lead', 'seo_manager'))
  with check (can_access_project(project_id) and current_app_role() in ('team_lead', 'seo_manager'));

-- --- brief_topics (scoped via brief_versions.project_id) -------------------
-- Deterministic, app-derived, insert-only (Phase 4.3 plan §2B) — same
-- select+insert-only shape already used for research_sources/website_urls,
-- no update policy needed.

create policy brief_topics_select_accessible on brief_topics
  for select
  using (
    exists (
      select 1 from brief_versions bv
      where bv.id = brief_version_id and can_access_project(bv.project_id)
    )
  );

create policy brief_topics_insert_managers on brief_topics
  for insert
  with check (
    exists (
      select 1 from brief_versions bv
      where bv.id = brief_version_id
        and can_access_project(bv.project_id)
        and current_app_role() in ('team_lead', 'seo_manager')
    )
  );

-- --- brief_internal_links (scoped via brief_versions.project_id) ----------
-- AI-recommended candidates, insert-only, may legitimately be zero rows
-- (Phase 4.3 plan §0.3) — same shape as brief_topics.

create policy brief_internal_links_select_accessible on brief_internal_links
  for select
  using (
    exists (
      select 1 from brief_versions bv
      where bv.id = brief_version_id and can_access_project(bv.project_id)
    )
  );

create policy brief_internal_links_insert_managers on brief_internal_links
  for insert
  with check (
    exists (
      select 1 from brief_versions bv
      where bv.id = brief_version_id
        and can_access_project(bv.project_id)
        and current_app_role() in ('team_lead', 'seo_manager')
    )
  );
