-- Fix — harden the RLS helper functions introduced in Phase 2
-- (current_organization_id, current_app_role). Root cause of the
-- Phase 3 "new row violates row-level security policy for table
-- projects" failure: as plain (non-SECURITY DEFINER) functions with
-- no fixed search_path, their internal query against `profiles` runs
-- under the caller's privileges/search_path at evaluation time inside
-- another table's RLS policy check — which can resolve inconsistently
-- from how they resolve when called directly. Every other diagnostic
-- (auth identity, values, the projects_insert_managers policy itself,
-- absence of a BEFORE INSERT trigger, profiles' own RLS) was already
-- confirmed correct — this was the remaining variable.
--
-- Fix: make both SECURITY DEFINER with an explicit, fixed
-- search_path and schema-qualified references, so they resolve
-- identically regardless of the calling context. auth.uid() remains
-- the only input — still fully session-scoped, not spoofable by the
-- caller, so this does not weaken authorization.
--
-- Additive only: does not modify the original 13 migrations or the
-- Phase 2 migration that first defined these functions. Does not
-- touch the projects RLS policies or disable RLS anywhere.

create or replace function public.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from public.profiles where user_id = auth.uid()
$$;

create or replace function public.current_app_role()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where user_id = auth.uid()
$$;

grant execute on function public.current_organization_id() to authenticated, anon;
grant execute on function public.current_app_role() to authenticated, anon;
