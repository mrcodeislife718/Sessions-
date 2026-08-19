create table if not exists workspace_invitations (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  normalized_email text not null,
  email text not null,
  role text not null check (role in ('admin','member','viewer')),
  token_hash text not null unique,
  invited_by text references principals(id),
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  expires_at timestamptz not null,
  accepted_by text references principals(id),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, normalized_email, status)
);
create index if not exists idx_workspace_invitations_workspace on workspace_invitations(workspace_id, status, created_at desc);
create index if not exists idx_workspace_invitations_token on workspace_invitations(token_hash) where status='pending';
