-- Phase 4.4 infrastructure — Blueprint <-> Brief version lineage.
-- Locked decision BD1 (docs/architecture/phase-4-4-blueprint-plan.md
-- §0): a Blueprint version must be permanently pinned to the exact
-- Brief version it was generated from, never resolved dynamically
-- via content_briefs.current_version_id. As shipped,
-- blueprint_versions had no link at all to brief_versions.
--
-- blueprint_versions has zero rows today (confirmed directly against
-- the live database before writing this migration) — no Blueprint
-- generation stage exists yet. A `not null` column can therefore be
-- added directly; there is no existing Blueprint version history to
-- preserve or backfill, and none is created or altered by this file.

alter table blueprint_versions
  add column brief_version_id uuid not null references brief_versions(id);

create index blueprint_versions_brief_version_id_idx on blueprint_versions(brief_version_id);

-- Immutability, enforced at the database layer, not just by
-- application discipline: once a blueprint_versions row is inserted,
-- brief_version_id can never be changed by any subsequent UPDATE
-- (including the Approve/Request-changes actions, which only ever
-- touch status/approved_by/approved_at) — a Blueprint version can
-- never be silently re-pointed at a different Brief version.
create or replace function prevent_blueprint_version_brief_version_id_change()
returns trigger
language plpgsql
as $$
begin
  if NEW.brief_version_id <> OLD.brief_version_id then
    raise exception 'blueprint_versions.brief_version_id is immutable and cannot be changed after creation';
  end if;
  return NEW;
end;
$$;

create trigger blueprint_versions_brief_version_id_immutable
  before update on blueprint_versions
  for each row
  execute function prevent_blueprint_version_brief_version_id_change();
