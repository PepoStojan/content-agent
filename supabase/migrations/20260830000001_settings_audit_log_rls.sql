-- MILESTONE-02 — closes a real, previously-unaddressed gap the
-- milestone audit found: `settings` and `audit_log` have had RLS
-- enabled since Phase 0 (20260817000013_enable_rls.sql) with zero
-- policies ever added — the same "RLS enabled, zero policies" trap
-- every other artifact table in this schema hit and closed, never
-- revisited for these two. Reuses the existing SECURITY DEFINER
-- helpers (`current_organization_id()`, `current_app_role()`,
-- `can_access_project()`) unmodified — no new helper function.
--
-- Neither table is read or written by any application code today
-- (confirmed by search: zero `.from("settings")`/`.from("audit_log")`
-- call sites anywhere in the codebase; the Settings page is a
-- placeholder). This migration closes the RLS gap to the same
-- conservative, convention-following shape every other table in this
-- schema already has — it does not wire up any new feature or UI.

-- --- settings --------------------------------------------------------
-- Org-scoped, singleton-per-org config (strict_approval_gate,
-- structured_json_export_enabled, ai_model_id, file_size_limits) —
-- identical shape and intent to business_profiles/brand_profiles
-- (20260818000001_phase2_provisioning_and_rls.sql), so this mirrors
-- that exact policy set: read by any org member, write by
-- team_lead/seo_manager only.

create policy settings_select_org on settings
  for select
  using (organization_id = current_organization_id());

create policy settings_insert_managers on settings
  for insert
  with check (
    organization_id = current_organization_id()
    and current_app_role() in ('team_lead', 'seo_manager')
  );

create policy settings_update_managers on settings
  for update
  using (
    organization_id = current_organization_id()
    and current_app_role() in ('team_lead', 'seo_manager')
  )
  with check (
    organization_id = current_organization_id()
    and current_app_role() in ('team_lead', 'seo_manager')
  );

create policy settings_delete_managers on settings
  for delete
  using (
    organization_id = current_organization_id()
    and current_app_role() in ('team_lead', 'seo_manager')
  );

-- --- audit_log ---------------------------------------------------------
-- Project-scoped, append-only "who/what/when" trail (its own doc
-- comment, 20260817000012_audit_log.sql). Insert-only by design —
-- no UPDATE/DELETE policy, matching every other insert-only artifact
-- table in this schema (qa_reports/qa_findings/export_files, etc.):
-- an audit trail that could be edited or deleted after the fact isn't
-- one. SELECT is read-only for any user who can access the project
-- (same shape as every other project-scoped table's SELECT policy).
-- INSERT is deliberately not manager-gated the way Brief/Blueprint/
-- Content/QA/Export generation triggers are — an audit log's own
-- purpose is to record actions taken by *any* role, not just
-- managers — but a row may only ever be attributed to the actor
-- actually making the request (`actor_id = auth.uid()`), preventing
-- one user from forging an entry under another user's identity.

create policy audit_log_select_project on audit_log
  for select
  using (project_id is not null and can_access_project(project_id));

create policy audit_log_insert_own_action on audit_log
  for insert
  with check (
    project_id is not null
    and can_access_project(project_id)
    and actor_id = auth.uid()
  );
