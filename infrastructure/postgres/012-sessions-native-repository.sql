create table if not exists sessions_repository_refs (
  repository_id text not null references hosted_repositories(id) on delete cascade,
  ref_type text not null check (ref_type in ('branch','tag')),
  name text not null,
  checkpoint_id text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key(repository_id, ref_type, name)
);

create table if not exists sessions_repository_checkpoints (
  repository_id text not null references hosted_repositories(id) on delete cascade,
  checkpoint_id text not null,
  record jsonb not null,
  created_at timestamptz not null default now(),
  primary key(repository_id, checkpoint_id)
);

create table if not exists sessions_repository_objects (
  repository_id text not null references hosted_repositories(id) on delete cascade,
  object_id text not null,
  digest text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  content bytea not null,
  created_at timestamptz not null default now(),
  primary key(repository_id, object_id)
);
create index if not exists sessions_repository_objects_digest_idx on sessions_repository_objects(repository_id, digest);

create table if not exists sessions_repository_states (
  repository_id text primary key references hosted_repositories(id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

comment on table sessions_repository_refs is 'First-party Sessions branch/tag refs; not Git refs.';
comment on table sessions_repository_checkpoints is 'First-party Sessions commit/checkpoint records.';
comment on table sessions_repository_objects is 'First-party Sessions content-addressed source objects.';
comment on table sessions_repository_states is 'First-party Sessions repository state used for clone/fetch/pull.';
