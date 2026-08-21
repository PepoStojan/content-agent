-- Phase 4.7 foundation — Export/QA lineage columns on `exports`.
-- Locked: ED1 (docs/architecture/phase-4-7-export-plan.md) and ED12
-- (docs/architecture/phase-4-7-export-plan.md, LEAVES-02).
--
-- qa_report_id (ED1): the exact `qa_reports` row that existed at
-- export time, pinned once, never re-resolved — including a FAIL or
-- stale report if the export went through the ED12 bypass path.
-- Nullable, and stays null only when no QA report existed at all at
-- export time. Not `not null` — many legitimate exports (No-QA
-- bypass) have nothing to point at.
--
-- qa_bypassed (ED12): true only for an explicit "Export without QA"
-- action; false for every normal, gate-Allowed export (full or
-- partial QA, ED13). `qa_bypassed = true` must never be read as "QA
-- passed" — enforced at the application layer (computeExportGate()),
-- not by this column alone.

alter table exports
  add column qa_report_id uuid references qa_reports(id),
  add column qa_bypassed boolean not null default false;

create index exports_qa_report_id_idx on exports(qa_report_id);
