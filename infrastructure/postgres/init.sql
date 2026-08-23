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
  payload jsonb not null default '{}'::jsonb
);
create index if not exists idx_session_events_session_time on session_events(session_id, occurred_at);

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
