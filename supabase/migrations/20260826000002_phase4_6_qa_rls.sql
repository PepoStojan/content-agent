-- Phase 4.6 infrastructure — QA RLS policies.
-- qa_reports, qa_report_content_versions, qa_findings have had RLS
-- enabled since Phase 0 (migration 13) with zero policies (fully
-- locked) — the same "RLS enabled, zero policies" gap already fixed
-- for Brief (20260823000001), Blueprint (20260824000002), and Content
-- (20260825000002), now closed here for QA before any QA-generating
-- code is written against these tables.
--
-- Reuses the existing SECURITY DEFINER helpers only
-- (can_access_project, current_app_role) — no new helper function, so
-- no new recursion risk (see migrations 16/17 for that bug class).
--
-- Permission matrix:
--   SELECT: any user who can access the project (team_lead/seo_manager
--     org-wide, content_writer only if an explicit project_members
--     row) — same Content-Writer-is-read-only-here shape already
--     established for Brief/Blueprint/Content artifact tables. No
--     separate content_writer-specific policy is introduced; QA
--     triggering is a team_lead/seo_manager action per the existing
--     assertCanRunGenerations()/canManageProfiles() permission gate,
--     matching every other generation type.
--   INSERT: team_lead/seo_manager only, consistent with every other
--     generation-produced artifact table in this schema.
--
-- Deliberately no UPDATE and no DELETE policy on any of the three
-- tables (QD5, locked: "QA reports are immutable, insert-only
-- snapshots... no per-finding or per-category rerun in this phase").
-- Unlike content_briefs/content_blueprints/content_documents, QA has
-- no head-row/current-version-pointer to flip and no Approve action
-- (docs/architecture/phase-4-6-qa-plan.md §6: "QA never approves
-- anything... no qa_reports.approved_by/approved_at exists, and none
-- is proposed") — there is no legitimate UPDATE this schema needs to
-- support, so none is granted. With RLS enabled and no UPDATE/DELETE
-- policy present, both operations are default-denied for every role
-- including team_lead/seo_manager — this is the RLS-layer enforcement
-- of QD5's immutability guarantee, not merely an application-code
-- convention. "Re-run validation" must always INSERT a new qa_reports
-- row; there is no row it could instead update even if application
-- code tried to.

-- --- qa_reports ------------------------------------------------------
-- project_id exists directly on this table (like brief_versions/
-- blueprint_versions/content_versions) — policies are keyed on it
-- directly, no exists() join needed.

create policy qa_reports_select_accessible on qa_reports
  for select
  using (can_access_project(project_id));

create policy qa_reports_insert_managers on qa_reports
  for insert
  with check (
    can_access_project(project_id)
    and current_app_role() in ('team_lead', 'seo_manager')
  );

-- --- qa_report_content_versions (scoped via qa_reports.project_id) ------
-- No project_id of its own — resolved via a join to qa_reports,
-- same join-through-parent pattern already used for
-- brief_topics/brief_internal_links (via brief_versions) and
-- blueprint_nodes (via blueprint_versions).

create policy qa_report_content_versions_select_accessible on qa_report_content_versions
  for select
  using (
    exists (
      select 1 from qa_reports qr
      where qr.id = qa_report_id and can_access_project(qr.project_id)
    )
  );

create policy qa_report_content_versions_insert_managers on qa_report_content_versions
  for insert
  with check (
    exists (
      select 1 from qa_reports qr
      where qr.id = qa_report_id
        and can_access_project(qr.project_id)
        and current_app_role() in ('team_lead', 'seo_manager')
    )
  );

-- --- qa_findings (scoped via qa_reports.project_id) ---------------------
-- Same join-through-parent shape as qa_report_content_versions above.
-- The new content_version_id column (20260826000001, QD1) does not
-- change this table's access scope — a finding is still only ever
-- reachable through its own qa_report_id's project, whether or not it
-- also happens to reference a specific content_version.

create policy qa_findings_select_accessible on qa_findings
  for select
  using (
    exists (
      select 1 from qa_reports qr
      where qr.id = qa_report_id and can_access_project(qr.project_id)
    )
  );

create policy qa_findings_insert_managers on qa_findings
  for insert
  with check (
    exists (
      select 1 from qa_reports qr
      where qr.id = qa_report_id
        and can_access_project(qr.project_id)
        and current_app_role() in ('team_lead', 'seo_manager')
    )
  );
