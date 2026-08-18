create table if not exists billing_events (
  id text primary key,
  billing_account_id text not null references billing_accounts(id) on delete cascade,
  event_type text not null,
  external_event_ref text,
  idempotency_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index if not exists idx_billing_events_account_time on billing_events(billing_account_id, occurred_at desc);

create table if not exists workspace_limits (
  workspace_id text primary key,
  hosted_repository_limit integer check (hosted_repository_limit is null or hosted_repository_limit >= 0),
  runner_seconds_monthly_limit bigint check (runner_seconds_monthly_limit is null or runner_seconds_monthly_limit >= 0),
  storage_bytes_limit bigint check (storage_bytes_limit is null or storage_bytes_limit >= 0),
  retained_event_bytes_limit bigint check (retained_event_bytes_limit is null or retained_event_bytes_limit >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists product_events (
  id text primary key,
  workspace_id text not null,
  principal_id text,
  event_name text not null,
  source text not null default 'product',
  session_id text,
  repository_id text,
  properties jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index if not exists idx_product_events_workspace_time on product_events(workspace_id, occurred_at desc);
create index if not exists idx_product_events_name_time on product_events(event_name, occurred_at desc);

create table if not exists recovery_experiments (
  id text primary key,
  workspace_id text not null,
  session_id text not null,
  experiment_kind text not null,
  baseline_kind text,
  orientation_ms numeric not null check (orientation_ms >= 0),
  missing_context_count integer not null check (missing_context_count >= 0),
  reproduction_success boolean not null,
  continuation_ready boolean not null,
  reconstruction_accuracy numeric check (reconstruction_accuracy is null or (reconstruction_accuracy >= 0 and reconstruction_accuracy <= 1)),
  notes text,
  measured_at timestamptz not null default now()
);
create index if not exists idx_recovery_experiments_workspace_time on recovery_experiments(workspace_id, measured_at desc);

create table if not exists data_export_requests (
  id text primary key,
  workspace_id text not null,
  requested_by text not null,
  status text not null check (status in ('requested','processing','ready','failed','expired')),
  storage_key text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz
);
create index if not exists idx_data_export_workspace_time on data_export_requests(workspace_id, requested_at desc);

create table if not exists cancellation_records (
  id text primary key,
  billing_account_id text not null references billing_accounts(id) on delete cascade,
  requested_by text,
  reason text,
  effective_at timestamptz not null,
  export_requested boolean not null default false,
  created_at timestamptz not null default now()
);
