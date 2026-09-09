begin;

create table if not exists private_runners (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  labels text[] not null default array[]::text[],
  max_concurrency integer not null default 1 check (max_concurrency between 1 and 64),
  status text not null default 'active' check (status in ('active','disabled','revoked')),
  last_seen_at timestamptz,
  created_by text references principals(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,name)
);
create index if not exists private_runners_workspace_status_idx on private_runners(workspace_id,status,last_seen_at desc);

create table if not exists repository_runner_policies (
  workspace_id text not null references workspaces(id) on delete cascade,
  repository_id text not null references hosted_repositories(id) on delete cascade,
  execution_target text not null default 'hosted' check (execution_target in ('hosted','private','either')),
  required_labels text[] not null default array[]::text[],
  created_by text references principals(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(repository_id)
);
create index if not exists repository_runner_policies_workspace_idx on repository_runner_policies(workspace_id,execution_target);

alter table action_runs drop constraint if exists action_runs_execution_kind_check;
alter table action_runs add constraint action_runs_execution_kind_check check (execution_kind in ('native_verification','customer_workflow','private_workflow'));
alter table action_runs add column if not exists execution_target text not null default 'hosted' check (execution_target in ('hosted','private','either'));
alter table action_runs add column if not exists runner_labels text[] not null default array[]::text[];
alter table action_runs add column if not exists assigned_private_runner_id uuid references private_runners(id) on delete set null;
alter table action_runs add column if not exists runner_lease_expires_at timestamptz;
create index if not exists action_runs_private_queue_idx on action_runs(workspace_id,status,created_at) where execution_target in ('private','either') and status in ('queued','running');

create or replace function sessions_apply_runner_policy() returns trigger as $$
declare policy repository_runner_policies%rowtype;
begin
  if new.execution_kind not in ('customer_workflow','private_workflow') then return new; end if;
  select * into policy from repository_runner_policies where workspace_id=new.workspace_id and repository_id=new.repository_id;
  if found then
    new.execution_target:=policy.execution_target;
    new.runner_labels:=policy.required_labels;
    if policy.execution_target='private' then new.execution_kind:='private_workflow';
    elsif new.execution_kind='private_workflow' then new.execution_kind:='customer_workflow'; end if;
  else
    new.execution_target:='hosted';
    new.runner_labels:=array[]::text[];
    if new.execution_kind='private_workflow' then new.execution_kind:='customer_workflow'; end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_sessions_apply_runner_policy on action_runs;
create trigger trg_sessions_apply_runner_policy before insert on action_runs for each row execute function sessions_apply_runner_policy();

-- Runner policy is repository state and therefore obeys archive/deletion quarantine.
do $$ begin
  if to_regprocedure('public.sessions_require_active_repository_write()') is not null then
    drop trigger if exists trg_sessions_active_repo_runner_policy on repository_runner_policies;
    create trigger trg_sessions_active_repo_runner_policy before insert or update or delete on repository_runner_policies for each row execute function sessions_require_active_repository_write();
  end if;
end $$;

commit;
