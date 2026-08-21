-- Phase 4.6 — QA schema foundation (QD1, locked in
-- docs/architecture/phase-4-6-qa-plan.md). qa_findings as shipped in
-- Phase 0 (20260817000010_qa.sql) has qa_report_id/category/method/
-- status/note only — it can prove which content_versions a REPORT as
-- a whole evaluated (via qa_report_content_versions), but not which
-- content_version an individual FINDING is about. A "topics" finding
-- and a "factual" finding on the same report are otherwise
-- indistinguishable in terms of which of N leaf sections they concern
-- once a document has more than one section, which is every real
-- document. This is the same class of gap Blueprint's
-- brief_version_id (20260824000001) and Content's
-- generation_runs.blueprint_node_id (20260825000001) each closed in
-- their own phase.
--
-- Nullable: whole-document categories (intent, structure) never set
-- this; per-section categories (topics, entities, links, brand,
-- factual, style, forbidden_chars) always do. No second
-- blueprint_node_id column is added alongside it — content_versions
-- already carries blueprint_node_id, so this one FK is sufficient to
-- resolve "which section" without a redundant column.

alter table qa_findings
  add column content_version_id uuid references content_versions(id);

create index qa_findings_content_version_id_idx on qa_findings(content_version_id);
