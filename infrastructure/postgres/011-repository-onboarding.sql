create table if not exists repository_git_imports (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  repository_id text not null references hosted_repositories(id) on delete cascade,
  source_kind text not null default 'git',
  source_url text,
  commit_count integer not null default 0 check (commit_count >= 0),
  branch_count integer not null default 0 check (branch_count >= 0),
  tag_count integer not null default 0 check (tag_count >= 0),
  imported_at timestamptz not null default now()
);
create index if not exists idx_repository_git_imports_repo on repository_git_imports(repository_id, imported_at desc);

create table if not exists repository_git_commits (
  repository_id text not null references hosted_repositories(id) on delete cascade,
  git_sha text not null,
  sessions_checkpoint_id text not null,
  subject text,
  actor_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz,
  primary key(repository_id, git_sha)
);

create table if not exists repository_git_refs (
  repository_id text not null references hosted_repositories(id) on delete cascade,
  ref_type text not null check (ref_type in ('branch','tag')),
  name text not null,
  git_sha text,
  sessions_checkpoint_id text,
  primary key(repository_id, ref_type, name)
);
