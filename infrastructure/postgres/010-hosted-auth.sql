create table if not exists hosted_auth_accounts (
  principal_id text primary key references principals(id) on delete cascade,
  email text not null,
  normalized_email text not null unique,
  password_salt text not null,
  password_hash text not null,
  password_version integer not null default 1,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_hosted_auth_accounts_email on hosted_auth_accounts(normalized_email);

alter table billing_accounts alter column status set default 'pending';
