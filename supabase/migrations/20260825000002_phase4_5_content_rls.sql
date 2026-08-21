-- Phase 4.5 — Content RLS policies. content_documents and
-- content_versions have had RLS enabled since Phase 0 (migration 13)
-- with zero policies (fully locked) — the same "RLS enabled, zero
-- policies" gap already fixed for Brief (20260823000001) and
-- Blueprint (20260824000002), now closed here for Content before any
-- generation persists against these tables. This is the confirmed,
-- live-reproduced blocker: a real generateContentSection() call
-- (project 64f3a6aa-3090-457a-ae54-3a1d506a87d2, node
-- da86df57-6ac2-45c2-bc65-5f51269610f5) passed input assembly,
-- evidence filtering, the real Anthropic call, validation, and raw
-- output persistence, then failed exactly at persistContentVersion's
-- content_documents insert with "new row violates row-level security
-- policy for table content_documents" — this migration is the fix.
--
-- Reuses the existing SECURITY DEFINER helpers only
-- (can_access_project, current_app_role) — no new helper function, so
-- no new recursion risk (see migrations 16/17 for that bug class).
--
-- Permission matrix, matching content_briefs/brief_versions and
-- content_blueprints/blueprint_versions exactly:
--   SELECT: any user who can access the project (team_lead/seo_manager
--     org-wide, content_writer only if an explicit project_members row)
--     — this is also how Content Writer's read access is scoped; no
--     separate content_writer-specific policy is introduced.
--   INSERT/UPDATE: team_lead/seo_manager only, consistent with every
--     other generation-produced artifact table in this schema —
--     Content Writer has read-only access here, same as Brief/
--     Blueprint. Widening this to let Content Writer edit sections
--     directly is a distinct, not-yet-made product decision and is
--     not implied by this migration.
--
-- Content generation itself (Phase 4.5's generateContentSection) is
-- already implemented and blocked only on this migration — applying
-- it does not change generation behavior, only unblocks the existing
-- insert-only persistence path (persist.ts) that was already written
-- against this exact policy shape.

-- --- content_documents ----------------------------------------------------
-- Head row, one per leaf blueprint_node (unique constraint already
-- enforces this). UPDATE is required for the same reason as
-- content_briefs/content_blueprints: persistContentVersion() flips
-- content_documents.current_version_id as its last step, on an
-- already-existing head row (head+version+flip-last, CD5/CD6).

create policy content_documents_select_accessible on content_documents
  for select
  using (can_access_project(project_id));

create policy content_documents_insert_managers on content_documents
  for insert
  with check (
    can_access_project(project_id)
    and current_app_role() in ('team_lead', 'seo_manager')
  );

create policy content_documents_update_managers on content_documents
  for update
  using (can_access_project(project_id) and current_app_role() in ('team_lead', 'seo_manager'))
  with check (can_access_project(project_id) and current_app_role() in ('team_lead', 'seo_manager'));

-- --- content_versions ------------------------------------------------------
-- project_id exists directly on this table (like brief_versions/
-- blueprint_versions, unlike blueprint_nodes/brief_topics which need
-- a join) — policies are keyed on it directly, no exists() join
-- needed.
--
-- INSERT permits every new content_versions row: both an AI-generated
-- version (Regenerate) and a manual Edit insert this way (CD5 — Edit
-- and Regenerate share the exact same insert-only path in persist.ts,
-- distinguished only by whether generation_run_id/model_id/
-- prompt_version are present). This policy does not and must not
-- weaken CD5's insert-only discipline at the RLS layer — RLS controls
-- *who* may write a row, application code (persist.ts) is what
-- guarantees no existing content_versions row is ever updated in
-- place; this migration does not change that guarantee.
--
-- UPDATE is required for the future Approve action (status='approved',
-- approved_by, approved_at — not implemented yet, but this is the
-- exact same UPDATE need brief_versions/blueprint_versions already
-- have for their own Approve actions) applied to the current version
-- row only. It is not used, and must not be used, to rewrite a
-- version's body/content_document_id/blueprint_node_id/version number
-- after insert — application code is what enforces that restraint,
-- same as everywhere else in this schema (RLS grants row-level write
-- access; it does not constrain which columns a permitted update may
-- touch).

create policy content_versions_select_accessible on content_versions
  for select
  using (can_access_project(project_id));

create policy content_versions_insert_managers on content_versions
  for insert
  with check (
    can_access_project(project_id)
    and current_app_role() in ('team_lead', 'seo_manager')
  );

create policy content_versions_update_managers on content_versions
  for update
  using (can_access_project(project_id) and current_app_role() in ('team_lead', 'seo_manager'))
  with check (can_access_project(project_id) and current_app_role() in ('team_lead', 'seo_manager'));
