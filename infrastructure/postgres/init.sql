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
