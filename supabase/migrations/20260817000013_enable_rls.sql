-- Architecture V1 — enable Row Level Security on every tenant-scoped
-- table as a default-deny posture. No policies are defined yet: that
-- is the permission-model implementation (Team Lead / SEO Manager /
-- Content Writer matrix), which is feature-workflow work for a later
-- phase, not Phase 0 infrastructure. Until policies exist, only the
-- service-role client (lib/supabase/admin.ts) can read/write these
-- tables — the anon/authenticated roles get nothing.

alter table organizations enable row level security;
alter table profiles enable row level security;
alter table business_profiles enable row level security;
alter table brand_profiles enable row level security;
alter table settings enable row level security;
alter table projects enable row level security;
alter table project_members enable row level security;
alter table project_files enable row level security;
alter table research_packages enable row level security;
alter table research_sources enable row level security;
alter table website_datasets enable row level security;
alter table website_urls enable row level security;
alter table internal_link_candidates enable row level security;
alter table content_briefs enable row level security;
alter table brief_versions enable row level security;
alter table brief_topics enable row level security;
alter table brief_internal_links enable row level security;
alter table content_blueprints enable row level security;
alter table blueprint_versions enable row level security;
alter table blueprint_nodes enable row level security;
alter table content_documents enable row level security;
alter table content_versions enable row level security;
alter table qa_reports enable row level security;
alter table qa_report_content_versions enable row level security;
alter table qa_findings enable row level security;
alter table exports enable row level security;
alter table export_content_versions enable row level security;
alter table export_files enable row level security;
alter table generation_runs enable row level security;
alter table audit_log enable row level security;
