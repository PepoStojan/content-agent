-- Phase 4.5 — Content Generation database/concurrency foundation (CD3,
-- locked in docs/architecture/phase-4-5-content-generation-plan.md).
-- Content generation is one job PER SECTION (blueprint_node), not per
-- project — the existing Phase 4.2 D2 lock
-- (generation_runs_one_active_per_project_type, keyed on
-- (project_id, type)) would incorrectly treat two different sections'
-- legitimate simultaneous content_generate runs as a conflict. This
-- was flagged as a known future requirement at Phase 4.2 design time
-- (docs/architecture/phase-4-2-generation-engine.md §3) and deferred
-- until content generation was actually being built — it is now.

-- --- New column -----------------------------------------------------
-- Nullable: only content_generate rows ever set this. Every other
-- generation_run_type (research_parse, website_parse, brief_generate,
-- blueprint_generate, qa_run, export) has no notion of a Blueprint
-- node and leaves this NULL, exactly as before this migration.
alter table generation_runs
  add column blueprint_node_id uuid references blueprint_nodes(id);

create index generation_runs_blueprint_node_id_idx on generation_runs(blueprint_node_id);

-- --- Re-scope the D2 lock ---------------------------------------------
-- Drop the (project_id, type)-only lock and replace it with a lock
-- keyed on (project_id, type, blueprint_node_id) so two different
-- sections of the same project can generate content simultaneously,
-- while two attempts at the SAME section still collide exactly as
-- intended.
--
-- coalesce(...) is required, not cosmetic: Postgres unique indexes
-- treat NULL as distinct from every other NULL, so a bare
-- (project_id, type, blueprint_node_id) unique index would silently
-- stop guarding every non-content generation type (blueprint_node_id
-- is always NULL for those) — two simultaneous brief_generate runs
-- for the same project would no longer conflict. Coalescing NULL to a
-- fixed sentinel UUID collapses all "no node" rows back onto the
-- original (project_id, type) key, preserving the exact pre-existing
-- guarantee for every generation type that doesn't use blueprint
-- nodes, while giving content_generate its own per-node key.
drop index generation_runs_one_active_per_project_type;

create unique index generation_runs_one_active_per_project_type_node
  on generation_runs (project_id, type, coalesce(blueprint_node_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status in ('queued', 'running', 'provider_completed', 'artifact_persisted');
