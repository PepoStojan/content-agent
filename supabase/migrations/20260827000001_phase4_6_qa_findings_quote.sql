-- Phase 4.6 — QU3/QD7 storage gap fix (locked in
-- docs/architecture/phase-4-6-qa-ui-plan.md, QU3). `qa_findings.note`
-- previously had the LLM's literal quote baked into the same string
-- (`generate-qa-report.ts`'s `validateLlmFinding()`:
-- `"${raw.note} (quote: \"${quote}\")"`), so the UI could not show
-- "explanation" and "literal quote" as two distinct fields without
-- fragile string-parsing. This closes that gap the same way QD1
-- closed the earlier `content_version_id` gap: one new nullable
-- column, additive only.
--
-- Semantics, effective immediately for new QA runs:
--   note  = the explanation only (no quote embedded in the string).
--   quote = the exact literal excerpt from the evaluated content,
--           required for every LLM finding above PASS (QD7,
--           unchanged) and NULL for every deterministic finding
--           (deterministic findings have no "quote" concept — their
--           note text already states the mechanical reason) and for
--           any LLM finding whose status is PASS.
--
-- Existing rows from the one real QA run made before this migration
-- are left exactly as they are (note still contains the embedded
-- "(quote: ...)" suffix for that historical report) — no backfill,
-- no rewrite of already-persisted, immutable qa_findings rows. QD5's
-- immutability discipline applies to this column exactly as it does
-- to every other qa_findings column: written once at insert time,
-- never updated afterward (no UPDATE policy exists on this table,
-- confirmed unchanged by 20260826000002_phase4_6_qa_rls.sql).

alter table qa_findings
  add column quote text;
