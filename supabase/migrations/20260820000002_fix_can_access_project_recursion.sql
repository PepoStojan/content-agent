-- Fix — eliminate RLS recursion in can_access_project().
--
-- Root cause: can_access_project() queried public.projects directly
-- while running as SECURITY INVOKER, but it is also the USING
-- expression of projects_select_accessible on that same table. When
-- ensureDraftProject() did `.insert(...).select("id")`, the RETURNING
-- clause forced Postgres to re-check the new row against
-- projects_select_accessible, which called can_access_project(),
-- which queried projects again under the same policy — a recursive,
-- RLS-governed self-reference. This produced the exact same error
-- text as a WITH CHECK failure ("new row violates row-level security
-- policy for table projects"), even though the INSERT's own WITH
-- CHECK was passing.
--
-- Fix: SECURITY DEFINER + fixed search_path + schema-qualified
-- references, so its internal queries bypass RLS re-evaluation
-- instead of recursing into the policy that depends on it — same
-- treatment already applied to current_organization_id()/
-- current_app_role() in 20260820000001.
--
-- projects_select_accessible itself is untouched: still
-- `USING (can_access_project(id))`, still enforced, RLS still
-- enabled. Additive only — does not modify any existing migration.

create or replace function public.can_access_project(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = target_project_id
      and p.organization_id = public.current_organization_id()
      and (
        public.current_app_role() in ('team_lead', 'seo_manager')
        or exists (
          select 1 from public.project_members pm
          where pm.project_id = p.id and pm.user_id = auth.uid()
        )
      )
  )
$$;

grant execute on function public.can_access_project(uuid) to authenticated, anon;
