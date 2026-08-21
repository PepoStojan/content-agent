-- Phase 4.7 foundation — Partial QA category persistence.
-- Locked: QD9 (docs/architecture/phase-4-6-qa-plan.md, LEAVES-04).
--
-- Both arrays are explicitly persisted at report-creation time, never
-- derived from `qa_findings` (a legitimately-evaluated category can
-- have zero findings — see QD9's own reasoning, the real `factual`
-- thin-project case). `evaluated_categories`/`skipped_categories` are
-- complementary: together they always cover exactly the 9 frozen
-- `qa_category` values, for every report, full or partial. A skipped
-- category is never interpreted as PASS — it has no `qa_findings`
-- rows and is represented only by its presence in `skipped_categories`.
--
-- Backfill: 3 `qa_reports` rows already exist (confirmed live), every
-- one of them a full run under the pre-QD9 behavior (partial QA did
-- not exist until this migration). The literal `default` below
-- backfills those existing rows to `evaluated_categories = all 9`,
-- `skipped_categories = {}` — an accurate historical record, not a
-- guess. New rows written by application code always pass explicit
-- values (QD9: "at least one evaluated category is required for a QA
-- run" is an application-layer/server-side check, not a DB
-- constraint — a report can never legitimately have all 9 in
-- `skipped_categories`, but the DB does not enforce that minimum
-- itself, matching this schema's existing "app logic enforces
-- preconditions, RLS enforces access" division of responsibility).

alter table qa_reports
  add column evaluated_categories qa_category[] not null default array[
    'intent', 'topics', 'entities', 'structure', 'links', 'brand', 'factual', 'style', 'forbidden_chars'
  ]::qa_category[],
  add column skipped_categories qa_category[] not null default '{}'::qa_category[];
