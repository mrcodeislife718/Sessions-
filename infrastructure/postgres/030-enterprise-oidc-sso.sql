begin;

create table if not exists enterprise_oidc_providers (
  organization_id text primary key references organizations(id) on delete cascade,
  workspace_id text not null references workspaces(id) on delete cascade,
  issuer text not null,
  client_id text not null,
  client_secret_ciphertext text not null,
  client_secret_nonce text not null,
  client_secret_auth_tag text not null,
  allowed_domains text[] not null default array[]::text[],
  jit_role text not null default 'member' check (jit_role in ('member','viewer')),
  enforce_sso boolean not null default false,
  status text not null default 'active' check (status in ('active','disabled')),
  created_by text references principals(id),
  updated_by text references principals(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists enterprise_oidc_provider_issuer_client_idx
  on enterprise_oidc_providers(issuer,client_id) where status='active';

create table if not exists oidc_authorization_states (
  state_hash text primary key,
  organization_id text not null references organizations(id) on delete cascade,
  workspace_id text not null references workspaces(id) on delete cascade,
  nonce_hash text not null,
  return_to text not null default '/',
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists oidc_authorization_states_expiry_idx
  on oidc_authorization_states(expires_at);

create table if not exists oidc_login_tickets (
  ticket_hash text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  principal_id text not null references principals(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists oidc_login_tickets_expiry_idx
  on oidc_login_tickets(expires_at) where used_at is null;

comment on table enterprise_oidc_providers is
  'Enterprise OIDC configuration. Client secrets are encrypted with SESSIONS_SSO_MASTER_KEY; plaintext is never persisted.';
comment on table oidc_authorization_states is
  'Short-lived state and nonce records for authorization-code login-CSRF and replay protection.';
comment on table oidc_login_tickets is
  'Single-use post-callback tickets exchanged server-side for Sessions credentials; bearer credentials are never placed in redirect URLs.';

commit;
