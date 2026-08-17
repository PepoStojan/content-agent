-- Architecture V1 — QA. qa_reports pins the exact Brief/Blueprint
-- version evaluated and, via qa_report_content_versions, the exact
-- content_version evaluated per section — reproducible after newer
-- versions exist. Category-level PASS/WARN/FAIL only, no blended score
-- (engineering spec §16). 9 frozen categories with a deterministic or
-- llm method per finding (spec §14/§15).

create table qa_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  generation_run_id uuid references generation_runs(id),
  brief_version_id uuid references brief_versions(id),
  blueprint_version_id uuid references blueprint_versions(id),
  run_at timestamptz not null default now(),
  triggered_by uuid references auth.users(id),
  overall_status qa_status
);
create index qa_reports_project_id_idx on qa_reports(project_id);

create table qa_report_content_versions (
  id uuid primary key default gen_random_uuid(),
  qa_report_id uuid not null references qa_reports(id) on delete cascade,
  content_version_id uuid not null references content_versions(id)
);
create index qa_report_content_versions_qa_report_id_idx on qa_report_content_versions(qa_report_id);

create table qa_findings (
  id uuid primary key default gen_random_uuid(),
  qa_report_id uuid not null references qa_reports(id) on delete cascade,
  category qa_category not null,
  method qa_method not null,
  status qa_status not null,
  note text,
  created_at timestamptz not null default now()
);
create index qa_findings_qa_report_id_idx on qa_findings(qa_report_id);
