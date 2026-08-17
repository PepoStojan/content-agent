-- Architecture V1 — extensions and shared enum types.
-- Source of truth: docs/engineering/CLAUDE_CODE_SPEC.md + approved
-- architecture chat log. Do not alter enum members without re-approval.

create extension if not exists "pgcrypto";

create type user_role as enum ('team_lead', 'seo_manager', 'content_writer');

create type content_type as enum ('blog_post', 'landing_page', 'comparison_page', 'guide');

-- Engineering spec §18 — full project state machine. The Design V1
-- status badge is a derived view of this, not a redefinition of it.
create type project_status as enum (
  'draft',
  'ingesting',
  'ready_for_brief',
  'brief_generated',
  'brief_changes_requested',
  'brief_approved',
  'blueprint_generated',
  'blueprint_changes_requested',
  'blueprint_approved',
  'generating_content',
  'content_ready',
  'qa_failed',
  'qa_warning',
  'ready_for_export',
  'exported',
  'failed'
);

create type project_file_type as enum (
  'research_csv',
  'research_markdown',
  'research_docx',
  'sitemap_xml',
  'screaming_frog_csv'
);

create type file_validation_status as enum ('pending', 'valid', 'rejected');

-- Shared by research_packages and website_datasets — both model an
-- async upload -> parse job the same way.
create type upload_status as enum ('idle', 'uploading', 'parsing', 'parsed', 'failed');

-- Engineering spec §6 — Research Package normalization fields.
create type research_source_type as enum (
  'topic',
  'primary_query',
  'secondary_queries',
  'location',
  'organic_results',
  'parsed_pages',
  'failed_urls',
  'field_averages',
  'common_ground_topics',
  'competitor_unique_sections',
  'serp_features',
  'ai_overview',
  'paa',
  'related_searches',
  'content_gaps',
  'format_signals',
  'external_source_signals',
  'raw_competitor_content',
  'research_warnings'
);

create type website_url_source as enum ('sitemap', 'screaming_frog', 'both');

-- Used by brief_versions and blueprint_versions.
create type artifact_version_status as enum ('draft', 'approved');

create type content_version_status as enum ('ai_generated', 'approved');

-- Frozen: 9 QA categories (Design V1 README "Assumptions").
create type qa_category as enum (
  'intent',
  'topics',
  'entities',
  'structure',
  'links',
  'brand',
  'factual',
  'style',
  'forbidden_chars'
);

create type qa_method as enum ('deterministic', 'llm');
create type qa_status as enum ('pass', 'warn', 'fail');

create type export_status as enum ('idle', 'running', 'done', 'failed');

create type generation_run_type as enum (
  'research_parse',
  'website_parse',
  'brief_generate',
  'blueprint_generate',
  'content_generate',
  'qa_run',
  'export'
);

create type generation_run_status as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled');

-- Shared updated_at trigger.
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;
