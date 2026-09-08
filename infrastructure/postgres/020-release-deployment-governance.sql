begin;

create table if not exists repository_environment_policies (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references workspaces(id) on delete cascade,
  repository_id text not null,
  environment text not null,
  require_release boolean not null default true,
  require_verified_checkpoint boolean not null default true,
  required_approvals integer not null default 1 check (required_approvals between 0 and 100),
  required_human_approvals integer not null default 1 check (required_human_approvals between 0 and required_approvals),
  require_independent_approval boolean not null default true,
  restrict_ai_deploy boolean not null default false,
  created_by text references principals(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(repository_id, environment)
);
create index if not exists repository_environment_policies_repo_idx on repository_environment_policies(workspace_id,repository_id,environment);

create table if not exists deployment_approvals (
  id uuid primary key default gen_random_uuid(),
  deployment_id uuid not null references repository_deployments(id) on delete cascade,
  reviewer_principal_id text not null references principals(id),
  state text not null check (state in ('approved','rejected','dismissed')),
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(deployment_id, reviewer_principal_id)
);
create index if not exists deployment_approvals_deployment_idx on deployment_approvals(deployment_id,state);

alter table repository_releases add column if not exists source_digest text;
alter table repository_releases add column if not exists verification_state text not null default 'verified' check (verification_state in ('verified','requires_review','rejected'));
alter table repository_deployments add column if not exists source_digest text;
alter table repository_deployments add column if not exists approved_at timestamptz;
alter table repository_deployments add column if not exists started_at timestamptz;

create or replace function sessions_validate_release() returns trigger as $$
declare
  checkpoint jsonb;
  failed_checks integer;
  pending_runs integer;
begin
  select record into checkpoint from sessions_repository_checkpoints where repository_id=new.repository_id and checkpoint_id=new.commit_id;
  if checkpoint is null then raise exception 'release commit must identify a native Sessions checkpoint' using errcode='23514'; end if;
  if coalesce(checkpoint->>'lifecycle','draft') not in ('verified','reviewed','approved','published') then
    raise exception 'release checkpoint is not verified' using errcode='23514';
  end if;
  if coalesce((checkpoint->'recovery'->>'verified')::boolean,false) is not true then
    raise exception 'release checkpoint recovery is not verified' using errcode='23514';
  end if;
  select count(*) into failed_checks from action_checks ac join action_runs ar on ar.id=ac.action_run_id
    where ar.repository_id=new.repository_id and ar.commit_id=new.commit_id and ac.status='completed' and ac.conclusion='failure';
  select count(*) into pending_runs from action_runs ar
    where ar.repository_id=new.repository_id and ar.commit_id=new.commit_id and ar.status not in ('completed','cancelled');
  if failed_checks>0 or pending_runs>0 then raise exception 'release commit has unresolved Actions or verification state' using errcode='23514'; end if;
  new.source_digest:=checkpoint->>'sourceDigest';
  new.verification_state:='verified';
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_sessions_validate_release on repository_releases;
create trigger trg_sessions_validate_release before insert or update of commit_id on repository_releases for each row execute function sessions_validate_release();

create or replace function sessions_validate_deployment_create() returns trigger as $$
declare
  checkpoint jsonb;
  release_record record;
  policy repository_environment_policies%rowtype;
begin
  select record into checkpoint from sessions_repository_checkpoints where repository_id=new.repository_id and checkpoint_id=new.commit_id;
  if checkpoint is null then raise exception 'deployment commit must identify a native Sessions checkpoint' using errcode='23514'; end if;
  new.source_digest:=checkpoint->>'sourceDigest';
  if new.release_id is not null then
    select * into release_record from repository_releases where id=new.release_id and repository_id=new.repository_id;
    if release_record.id is null then raise exception 'deployment release does not belong to repository' using errcode='23514'; end if;
    if release_record.commit_id<>new.commit_id or release_record.verification_state<>'verified' then raise exception 'deployment must match a verified release commit' using errcode='23514'; end if;
  end if;
  select * into policy from repository_environment_policies where repository_id=new.repository_id and environment=new.environment;
  if found then
    if policy.require_release and new.release_id is null then raise exception 'environment requires a verified release' using errcode='23514'; end if;
    if policy.require_verified_checkpoint and coalesce(checkpoint->>'lifecycle','draft') not in ('verified','reviewed','approved','published') then raise exception 'environment requires a verified checkpoint' using errcode='23514'; end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_sessions_validate_deployment_create on repository_deployments;
create trigger trg_sessions_validate_deployment_create before insert or update of commit_id,release_id,environment on repository_deployments for each row execute function sessions_validate_deployment_create();

create or replace function sessions_gate_deployment_transition() returns trigger as $$
declare
  policy repository_environment_policies%rowtype;
  approvals integer:=0;
  human_approvals integer:=0;
  rejections integer:=0;
begin
  if new.status not in ('running','success') or old.status in ('running','success') then return new; end if;
  select * into policy from repository_environment_policies where repository_id=new.repository_id and environment=new.environment;
  if not found then return new; end if;
  select count(*) into approvals from deployment_approvals a
    where a.deployment_id=new.id and a.state='approved' and (not policy.require_independent_approval or a.reviewer_principal_id<>new.actor_principal_id);
  select count(*) into human_approvals from deployment_approvals a join principals p on p.id=a.reviewer_principal_id
    where a.deployment_id=new.id and a.state='approved' and p.kind='human' and (not policy.require_independent_approval or a.reviewer_principal_id<>new.actor_principal_id);
  select count(*) into rejections from deployment_approvals a where a.deployment_id=new.id and a.state='rejected';
  if rejections>0 then raise exception 'deployment has an active rejection' using errcode='23514'; end if;
  if approvals<policy.required_approvals then raise exception 'deployment approvals not satisfied' using errcode='23514'; end if;
  if human_approvals<policy.required_human_approvals then raise exception 'deployment human approvals not satisfied' using errcode='23514'; end if;
  if policy.restrict_ai_deploy and exists(select 1 from principals p where p.id=new.actor_principal_id and p.kind<>'human') then raise exception 'environment does not permit AI-initiated deployment' using errcode='23514'; end if;
  if new.status='running' and new.started_at is null then new.started_at:=now(); end if;
  if new.approved_at is null then new.approved_at:=now(); end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_sessions_gate_deployment_transition on repository_deployments;
create trigger trg_sessions_gate_deployment_transition before update of status on repository_deployments for each row execute function sessions_gate_deployment_transition();

commit;
