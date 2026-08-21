-- Phase 4.7 foundation — Export RLS policies.
-- exports, export_content_versions, export_files have had RLS
-- enabled since Phase 0 (migration 13) with zero policies (fully
-- locked) — the same "RLS enabled, zero policies" gap already fixed
-- for Brief (20260823000001), Blueprint (20260824000002), Content
-- (20260825000002), and QA (20260826000002), now closed here for
-- Export before any export-generating code is written against these
-- tables.
--
-- Reuses the existing SECURITY DEFINER helpers only
-- (can_access_project, current_app_role) — no new helper function, so
-- no new recursion risk (see migrations 16/17 for that bug class).
--
-- Permission matrix:
--   SELECT: any user who can access the project (team_lead/seo_manager
--     org-wide, content_writer only if an explicit project_members
--     row) — same shape as every other artifact table.
--   INSERT: team_lead/seo_manager only, matching every other
--     generation-adjacent action in this pipeline (ED9's own locked
--     wording, docs/architecture/phase-4-7-export-plan.md).
--
-- Unlike QA (fully immutable, zero UPDATE policy anywhere — QD5), an
-- export attempt has its own real lifecycle (ED4/ED8: idle -> running
-- -> done/failed) that lives on the same `exports` row, not split
-- across a head+version pair the way Brief/Blueprint/Content are.
-- `exports` therefore gets one narrow UPDATE policy scoped to that
-- lifecycle transition only (status/completed_at moving forward) —
-- this is not "arbitrary user edits": the four pinned lineage columns
-- (brief_version_id, blueprint_version_id, qa_report_id, qa_bypassed)
-- are written once at INSERT and this policy does not distinguish
-- which columns an UPDATE may touch (RLS cannot express per-column
-- constraints), so application code, not RLS, is the actual guarantee
-- those columns are never touched again post-INSERT — the same
-- "RLS is access control, a trigger or app-code discipline is
-- column-level immutability" division already used elsewhere in this
-- schema (e.g. blueprint_versions.brief_version_id's own immutability
-- trigger, 20260824000001). No UPDATE/DELETE policy at all on
-- export_content_versions/export_files — those rows are written once,
-- at export-creation time, and never revisited (ED9's own explicit
-- "no arbitrary UPDATE/DELETE" for both child tables).

-- --- exports --------------------------------------------------------
-- project_id exists directly on this table (like qa_reports).

create policy exports_select_accessible on exports
  for select
  using (can_access_project(project_id));

create policy exports_insert_managers on exports
  for insert
  with check (
    can_access_project(project_id)
    and current_app_role() in ('team_lead', 'seo_manager')
  );

create policy exports_update_managers on exports
  for update
  using (can_access_project(project_id) and current_app_role() in ('team_lead', 'seo_manager'))
  with check (can_access_project(project_id) and current_app_role() in ('team_lead', 'seo_manager'));

-- --- export_content_versions (scoped via exports.project_id) -----------
-- No project_id of its own — resolved via a join to exports, same
-- join-through-parent pattern already used for qa_report_content_versions
-- (via qa_reports) and blueprint_nodes (via blueprint_versions).

create policy export_content_versions_select_accessible on export_content_versions
  for select
  using (
    exists (
      select 1 from exports e
      where e.id = export_id and can_access_project(e.project_id)
    )
  );

create policy export_content_versions_insert_managers on export_content_versions
  for insert
  with check (
    exists (
      select 1 from exports e
      where e.id = export_id
        and can_access_project(e.project_id)
        and current_app_role() in ('team_lead', 'seo_manager')
    )
  );

-- --- export_files (scoped via exports.project_id) -----------------------
-- Same join-through-parent shape as export_content_versions above.

create policy export_files_select_accessible on export_files
  for select
  using (
    exists (
      select 1 from exports e
      where e.id = export_id and can_access_project(e.project_id)
    )
  );

create policy export_files_insert_managers on export_files
  for insert
  with check (
    exists (
      select 1 from exports e
      where e.id = export_id
        and can_access_project(e.project_id)
        and current_app_role() in ('team_lead', 'seo_manager')
    )
  );
