begin;

alter table hosted_repositories add column if not exists lifecycle_status text not null default 'active' check (lifecycle_status in ('active','archived','deletion_scheduled'));
alter table hosted_repositories add column if not exists archived_at timestamptz;
alter table hosted_repositories add column if not exists deletion_scheduled_at timestamptz;
alter table hosted_repositories add column if not exists purge_after timestamptz;
alter table hosted_repositories add column if not exists lifecycle_updated_by text references principals(id);
create index if not exists hosted_repositories_lifecycle_idx on hosted_repositories(workspace_id,lifecycle_status,purge_after);

create table if not exists repository_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references workspaces(id) on delete cascade,
  repository_id text not null,
  principal_id text references principals(id),
  action text not null check (action in ('archive','restore','schedule_delete','cancel_delete','purge')),
  previous_status text,
  next_status text,
  reason text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index if not exists repository_lifecycle_events_repo_idx on repository_lifecycle_events(workspace_id,repository_id,occurred_at desc);

create or replace function sessions_require_active_repository_write() returns trigger as $$
declare
  repository_value text;
  lifecycle text;
begin
  if tg_op='DELETE' then repository_value:=old.repository_id; else repository_value:=new.repository_id; end if;
  select lifecycle_status into lifecycle from hosted_repositories where id=repository_value;
  if lifecycle is null then raise exception 'repository does not exist' using errcode='23503'; end if;
  if lifecycle<>'active' then raise exception 'repository is read-only while lifecycle status is %',lifecycle using errcode='55000'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$ language plpgsql;

-- These are the user-visible/state-changing forge and native-source surfaces. Lifecycle
-- administration updates hosted_repositories itself and therefore remains possible.
drop trigger if exists trg_sessions_active_repo_issues on repository_issues;
create trigger trg_sessions_active_repo_issues before insert or update or delete on repository_issues for each row execute function sessions_require_active_repository_write();
drop trigger if exists trg_sessions_active_repo_pulls on pull_requests;
create trigger trg_sessions_active_repo_pulls before insert or update or delete on pull_requests for each row execute function sessions_require_active_repository_write();
drop trigger if exists trg_sessions_active_repo_actions on action_runs;
create trigger trg_sessions_active_repo_actions before insert or update or delete on action_runs for each row execute function sessions_require_active_repository_write();
drop trigger if exists trg_sessions_active_repo_releases on repository_releases;
create trigger trg_sessions_active_repo_releases before insert or update or delete on repository_releases for each row execute function sessions_require_active_repository_write();
drop trigger if exists trg_sessions_active_repo_deployments on repository_deployments;
create trigger trg_sessions_active_repo_deployments before insert or update or delete on repository_deployments for each row execute function sessions_require_active_repository_write();
drop trigger if exists trg_sessions_active_repo_refs on sessions_repository_refs;
create trigger trg_sessions_active_repo_refs before insert or update or delete on sessions_repository_refs for each row execute function sessions_require_active_repository_write();
drop trigger if exists trg_sessions_active_repo_checkpoints on sessions_repository_checkpoints;
create trigger trg_sessions_active_repo_checkpoints before insert or update or delete on sessions_repository_checkpoints for each row execute function sessions_require_active_repository_write();
drop trigger if exists trg_sessions_active_repo_state on sessions_repository_states;
create trigger trg_sessions_active_repo_state before insert or update or delete on sessions_repository_states for each row execute function sessions_require_active_repository_write();

commit;
