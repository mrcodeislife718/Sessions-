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

create table if not exists repository_action_secrets (
  workspace_id text not null references workspaces(id) on delete cascade,
  repository_id text not null,
  name text not null,
  ciphertext text not null,
  nonce text not null,
  auth_tag text not null,
  created_by text references principals(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(repository_id,name)
);
create index if not exists repository_action_secrets_workspace_repo_idx on repository_action_secrets(workspace_id,repository_id,name);

alter table action_runs add column if not exists workflow_id uuid references repository_action_workflows(id) on delete set null;
alter table action_runs add column if not exists workflow_name text;
alter table action_runs add column if not exists execution_kind text not null default 'native_verification' check (execution_kind in ('native_verification','customer_workflow'));

alter table action_checks add column if not exists command_argv jsonb;
alter table action_checks add column if not exists container_image text;
alter table action_checks add column if not exists timeout_seconds integer not null default 900 check (timeout_seconds between 1 and 3600);
alter table action_checks add column if not exists network_policy text not null default 'none' check (network_policy in ('none','egress'));
alter table action_checks add column if not exists secret_names jsonb not null default '[]'::jsonb;
alter table action_checks add column if not exists log_text text not null default '';
alter table action_checks add column if not exists exit_code integer;

create or replace function sessions_enqueue_customer_workflows() returns trigger as $$
declare
  workflow record;
  step jsonb;
  run_id uuid;
  event_name text;
begin
  if new.execution_kind <> 'native_verification' then return new; end if;
  event_name := case when new.trigger in ('sessions.push','commit') then 'push' when new.trigger='pull_request' then 'pull_request' else null end;
  if event_name is null then return new; end if;
  for workflow in
    select * from repository_action_workflows
    where workspace_id=new.workspace_id and repository_id=new.repository_id and enabled=true and event_name=any(triggers)
  loop
    run_id := gen_random_uuid();
    insert into action_runs(id,workspace_id,repository_id,commit_id,pull_request_id,trigger,status,actor_principal_id,workflow_id,workflow_name,execution_kind)
    values(run_id,new.workspace_id,new.repository_id,new.commit_id,new.pull_request_id,event_name,'queued',new.actor_principal_id,workflow.id,workflow.name,'customer_workflow');
    for step in select value from jsonb_array_elements(coalesce(workflow.definition->'steps','[]'::jsonb))
    loop
      insert into action_checks(action_run_id,name,category,status,command_argv,container_image,timeout_seconds,network_policy,secret_names)
      values(run_id,step->>'name',coalesce(step->>'category','test'),'queued',step->'command',coalesce(step->>'image','node:22-alpine'),coalesce((step->>'timeoutSeconds')::integer,900),coalesce(step->>'network','none'),coalesce(step->'secrets','[]'::jsonb));
    end loop;
  end loop;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_sessions_enqueue_customer_workflows on action_runs;
create trigger trg_sessions_enqueue_customer_workflows
after insert on action_runs
for each row execute function sessions_enqueue_customer_workflows();
