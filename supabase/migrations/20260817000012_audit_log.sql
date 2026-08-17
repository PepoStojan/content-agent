-- Architecture V1 — audit log. Records approvals and edits beyond
-- what approved_by/approved_at on each version row already captures,
-- for a full who/what/when trail per project.

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  actor_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_project_id_idx on audit_log(project_id);
create index audit_log_entity_idx on audit_log(entity_type, entity_id);
