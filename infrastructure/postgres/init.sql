create table if not exists sessions (
  id text primary key,
  workspace_id text not null,
  project_id text not null,
  repository_id text not null,
  objective text not null,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists session_events (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  type text not null,
  occurred_at timestamptz not null,
  actor jsonb not null,
  payload jsonb not null default '{}'::jsonb,
  correlation_id text,
  causation_id text,
  workspace_id text,
  project_id text,
  repository_id text
);
create index if not exists idx_session_events_session_time on session_events(session_id, occurred_at);
create index if not exists session_events_session_order_idx on session_events(session_id, occurred_at, id);
create index if not exists session_events_causation_idx on session_events(causation_id) where causation_id is not null;
create index if not exists session_events_correlation_idx on session_events(correlation_id) where correlation_id is not null;

create table if not exists snapshots (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  repository_id text not null,
  digest text not null,
  manifest jsonb not null,
  created_at timestamptz not null
);
create index if not exists idx_snapshots_session_created on snapshots(session_id, created_at desc);

create table if not exists verifications (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  snapshot_id text,
  kind text not null,
  status text not null,
  summary text not null,
  requested_by jsonb not null,
  started_at timestamptz not null,
  finished_at timestamptz not null
);
create index if not exists idx_verifications_session_finished on verifications(session_id, finished_at desc);

create table if not exists rollback_requests (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  snapshot_id text not null,
  status text not null,
  requested_by jsonb not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

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
create index if not exists engineering_memory_repository_subject_idx on engineering_memory(workspace_id, repository_id, subject, status);

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
create index if not exists semantic_relationships_source_idx on semantic_relationships(workspace_id, repository_id, source_kind, source_id);
create index if not exists semantic_relationships_target_idx on semantic_relationships(workspace_id, repository_id, target_kind, target_id);

-- Commercial layer. Local source control remains usable without these records.
create table if not exists billing_accounts (
  id text primary key,
  workspace_id text not null unique,
  plan_key text not null default 'free',
  status text not null default 'active',
  billing_email text,
  external_customer_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists subscriptions (
  id text primary key,
  billing_account_id text not null references billing_accounts(id) on delete cascade,
  plan_key text not null,
  status text not null,
  seats integer not null default 1 check (seats > 0),
  period_start timestamptz,
  period_end timestamptz,
  external_subscription_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_subscriptions_account on subscriptions(billing_account_id, status);

create table if not exists usage_events (
  id text primary key,
  billing_account_id text not null references billing_accounts(id) on delete cascade,
  workspace_id text not null,
  repository_id text,
  session_id text,
  dimension text not null,
  quantity numeric not null check (quantity >= 0),
  unit text not null,
  occurred_at timestamptz not null default now(),
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists idx_usage_events_account_time on usage_events(billing_account_id, occurred_at);
create index if not exists idx_usage_events_dimension_time on usage_events(dimension, occurred_at);
