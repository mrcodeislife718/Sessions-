begin;

alter table session_events add column if not exists correlation_id text;
alter table session_events add column if not exists causation_id text;
alter table session_events add column if not exists workspace_id text;
alter table session_events add column if not exists project_id text;
alter table session_events add column if not exists repository_id text;

create index if not exists session_events_session_order_idx
  on session_events(session_id, occurred_at, id);

create index if not exists session_events_causation_idx
  on session_events(causation_id)
  where causation_id is not null;

create index if not exists session_events_correlation_idx
  on session_events(correlation_id)
  where correlation_id is not null;

create table if not exists engineering_memory (
  id text primary key,
  workspace_id text not null,
  repository_id text not null,
  session_id text,
  kind text not null,
  subject text not null,
  summary text not null,
  confidence double precision not null check (confidence >= 0 and confidence <= 1),
  provenance_event_ids jsonb not null default '[]'::jsonb,
  evidence_ids jsonb not null default '[]'::jsonb,
  supersedes_memory_id text references engineering_memory(id),
  status text not null default 'active' check (status in ('active','superseded','invalidated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists engineering_memory_repository_subject_idx
  on engineering_memory(workspace_id, repository_id, subject, status);

create table if not exists semantic_relationships (
  id text primary key,
  workspace_id text not null,
  repository_id text not null,
  source_kind text not null,
  source_id text not null,
  relationship text not null,
  target_kind text not null,
  target_id text not null,
  confidence double precision not null check (confidence >= 0 and confidence <= 1),
  evidence_event_ids jsonb not null default '[]'::jsonb,
  analyzer_version text not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, repository_id, source_kind, source_id, relationship, target_kind, target_id, analyzer_version)
);

create index if not exists semantic_relationships_source_idx
  on semantic_relationships(workspace_id, repository_id, source_kind, source_id);
create index if not exists semantic_relationships_target_idx
  on semantic_relationships(workspace_id, repository_id, target_kind, target_id);

commit;
