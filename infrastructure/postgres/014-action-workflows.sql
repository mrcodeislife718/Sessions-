create table if not exists repository_action_workflows (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references workspaces(id) on delete cascade,
  repository_id text not null,
  name text not null,
  enabled boolean not null default true,
  triggers text[] not null default array['push']::text[],
  definition jsonb not null,
  created_by text references principals(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(repository_id,name)
);
create index if not exists repository_action_workflows_repo_idx on repository_action_workflows(workspace_id,repository_id,enabled);

alter table action_runs add column if not exists workflow_id uuid references repository_action_workflows(id) on delete set null;
alter table action_runs add column if not exists workflow_name text;
alter table action_runs add column if not exists execution_kind text not null default 'native_verification' check (execution_kind in ('native_verification','customer_workflow'));

alter table action_checks add column if not exists command_argv jsonb;
alter table action_checks add column if not exists container_image text;
alter table action_checks add column if not exists timeout_seconds integer not null default 900 check (timeout_seconds between 1 and 3600);
alter table action_checks add column if not exists log_text text not null default '';
alter table action_checks add column if not exists exit_code integer;
