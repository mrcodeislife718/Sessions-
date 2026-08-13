create table if not exists hosted_repositories (
  id text primary key,
  workspace_id text not null,
  name text not null,
  visibility text not null default 'private',
  default_workstream_id text,
  source_digest text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create index if not exists idx_hosted_repositories_workspace
  on hosted_repositories(workspace_id, updated_at desc);
