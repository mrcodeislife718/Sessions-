create table if not exists repository_objects (
  repository_id text not null references hosted_repositories(id) on delete cascade,
  object_id text not null,
  digest text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  storage_key text not null,
  created_at timestamptz not null default now(),
  primary key (repository_id, object_id)
);

create table if not exists repository_manifests (
  id text primary key,
  repository_id text not null references hosted_repositories(id) on delete cascade,
  source_digest text not null,
  manifest jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_repository_manifests_repo
  on repository_manifests(repository_id, created_at desc);
