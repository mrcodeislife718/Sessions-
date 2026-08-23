create table if not exists organizations (
  id text primary key,
  name text not null,
  status text not null default 'active' check (status in ('active','suspended','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workspaces (
  id text primary key,
  organization_id text not null references organizations(id) on delete cascade,
  name text not null,
  status text not null default 'active' check (status in ('active','suspended','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);
create index if not exists idx_workspaces_org on workspaces(organization_id, id);

create table if not exists principals (
  id text primary key,
  kind text not null check (kind in ('human','service','ai_worker')),
  display_name text not null,
  email text,
  status text not null default 'active' check (status in ('active','suspended','revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workspace_memberships (
  workspace_id text not null references workspaces(id) on delete cascade,
  principal_id text not null references principals(id) on delete cascade,
  role text not null check (role in ('owner','admin','member','viewer','runner')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, principal_id)
);
create index if not exists idx_workspace_memberships_principal on workspace_memberships(principal_id, workspace_id);

create table if not exists api_credentials (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  principal_id text not null references principals(id) on delete cascade,
  token_hash text not null unique,
  scopes text[] not null default array[]::text[],
  status text not null default 'active' check (status in ('active','revoked')),
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_api_credentials_workspace on api_credentials(workspace_id, status);

create table if not exists audit_events (
  id text primary key,
  workspace_id text,
  principal_id text,
  request_id text,
  action text not null,
  resource_type text not null,
  resource_id text,
  outcome text not null check (outcome in ('allowed','denied','error')),
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index if not exists idx_audit_events_workspace_time on audit_events(workspace_id, occurred_at desc);
create index if not exists idx_audit_events_request on audit_events(request_id);

create table if not exists idempotency_records (
  workspace_id text not null,
  idempotency_key text not null,
  operation text not null,
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  primary key (workspace_id, idempotency_key)
);
create index if not exists idx_idempotency_expiry on idempotency_records(expires_at);
