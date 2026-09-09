begin;

create table if not exists oidc_identity_links (
  organization_id text not null references organizations(id) on delete cascade,
  issuer text not null,
  subject text not null,
  principal_id text not null references principals(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  last_login_at timestamptz not null default now(),
  primary key(organization_id,issuer,subject),
  unique(organization_id,principal_id)
);
create index if not exists oidc_identity_links_org_email_idx
  on oidc_identity_links(organization_id,lower(email));

comment on table oidc_identity_links is
  'Organization-scoped OIDC subject binding. Email is profile evidence, never the durable external identity key.';

commit;
