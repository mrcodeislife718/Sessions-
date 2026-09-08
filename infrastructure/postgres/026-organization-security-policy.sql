begin;

create table if not exists organization_security_policies (
  organization_id text primary key references organizations(id) on delete cascade,
  protected_branches text[] not null default array['main']::text[],
  min_branch_approvals integer not null default 1 check (min_branch_approvals between 0 and 100),
  min_branch_human_approvals integer not null default 1 check (min_branch_human_approvals between 0 and min_branch_approvals),
  require_independent_review boolean not null default true,
  require_verification boolean not null default true,
  require_actions_success boolean not null default true,
  block_changes_requested boolean not null default true,
  restrict_ai_merge boolean not null default false,
  protected_environments text[] not null default array['production']::text[],
  min_deployment_approvals integer not null default 1 check (min_deployment_approvals between 0 and 100),
  min_deployment_human_approvals integer not null default 1 check (min_deployment_human_approvals between 0 and min_deployment_approvals),
  require_independent_deployment_approval boolean not null default true,
  require_release boolean not null default true,
  require_verified_checkpoint boolean not null default true,
  require_attested_artifact boolean not null default false,
  require_sbom boolean not null default false,
  restrict_ai_deploy boolean not null default false,
  created_by text references principals(id),
  updated_by text references principals(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function sessions_enforce_branch_policy_floor() returns trigger as $$
declare orgp organization_security_policies%rowtype;
begin
  select osp.* into orgp
  from hosted_repositories r join workspaces w on w.id=r.workspace_id
  join organization_security_policies osp on osp.organization_id=w.organization_id
  where r.id=new.repository_id;
  if not found or not (new.branch_name=any(orgp.protected_branches)) then return new; end if;
  if new.required_approvals<orgp.min_branch_approvals then raise exception 'repository branch policy cannot weaken organization approval minimum' using errcode='23514'; end if;
  if new.required_human_approvals<orgp.min_branch_human_approvals then raise exception 'repository branch policy cannot weaken organization human approval minimum' using errcode='23514'; end if;
  if orgp.require_independent_review and not new.require_independent_approval then raise exception 'repository branch policy cannot disable organization independent review requirement' using errcode='23514'; end if;
  if orgp.require_verification and not new.require_verification then raise exception 'repository branch policy cannot disable organization verification requirement' using errcode='23514'; end if;
  if orgp.require_actions_success and not new.require_actions_success then raise exception 'repository branch policy cannot disable organization Actions requirement' using errcode='23514'; end if;
  if orgp.block_changes_requested and not new.block_changes_requested then raise exception 'repository branch policy cannot disable organization change-request blocking' using errcode='23514'; end if;
  if orgp.restrict_ai_merge and not new.restrict_ai_merge then raise exception 'repository branch policy cannot enable AI merge where organization forbids it' using errcode='23514'; end if;
  return new;
end;
$$ language plpgsql;
drop trigger if exists trg_sessions_enforce_branch_policy_floor on repository_branch_policies;
create trigger trg_sessions_enforce_branch_policy_floor before insert or update on repository_branch_policies for each row execute function sessions_enforce_branch_policy_floor();

create or replace function sessions_enforce_environment_policy_floor() returns trigger as $$
declare orgp organization_security_policies%rowtype;
begin
  select osp.* into orgp
  from hosted_repositories r join workspaces w on w.id=r.workspace_id
  join organization_security_policies osp on osp.organization_id=w.organization_id
  where r.id=new.repository_id;
  if not found or not (new.environment=any(orgp.protected_environments)) then return new; end if;
  if new.required_approvals<orgp.min_deployment_approvals then raise exception 'repository environment policy cannot weaken organization deployment approval minimum' using errcode='23514'; end if;
  if new.required_human_approvals<orgp.min_deployment_human_approvals then raise exception 'repository environment policy cannot weaken organization deployment human approval minimum' using errcode='23514'; end if;
  if orgp.require_independent_deployment_approval and not new.require_independent_approval then raise exception 'repository environment policy cannot disable organization independent deployment approval' using errcode='23514'; end if;
  if orgp.require_release and not new.require_release then raise exception 'repository environment policy cannot disable organization release requirement' using errcode='23514'; end if;
  if orgp.require_verified_checkpoint and not new.require_verified_checkpoint then raise exception 'repository environment policy cannot disable organization checkpoint verification' using errcode='23514'; end if;
  if orgp.require_attested_artifact and not new.require_attested_artifact then raise exception 'repository environment policy cannot disable organization artifact attestation requirement' using errcode='23514'; end if;
  if orgp.require_sbom and not new.require_sbom then raise exception 'repository environment policy cannot disable organization SBOM requirement' using errcode='23514'; end if;
  if orgp.restrict_ai_deploy and not new.restrict_ai_deploy then raise exception 'repository environment policy cannot enable AI deployment where organization forbids it' using errcode='23514'; end if;
  return new;
end;
$$ language plpgsql;
drop trigger if exists trg_sessions_enforce_environment_policy_floor on repository_environment_policies;
create trigger trg_sessions_enforce_environment_policy_floor before insert or update on repository_environment_policies for each row execute function sessions_enforce_environment_policy_floor();

create or replace function sessions_enforce_pull_request_merge_policy() returns trigger as $$
declare
  rp repository_branch_policies%rowtype;
  op organization_security_policies%rowtype;
  repo_found boolean:=false;
  org_applies boolean:=false;
  required_approvals integer:=0;
  required_human integer:=0;
  independent boolean:=false;
  verification_required boolean:=false;
  actions_required boolean:=false;
  block_changes boolean:=false;
  ai_restricted boolean:=false;
  approval_count integer:=0;
  human_approval_count integer:=0;
  blocking_change_requests integer:=0;
  pending_runs integer:=0;
  failed_checks integer:=0;
  head_ref text;
  merger_kind text;
begin
  if new.state<>'merged' or old.state='merged' then return new; end if;
  select * into rp from repository_branch_policies where workspace_id=new.workspace_id and repository_id=new.repository_id and branch_name=new.base_branch;
  repo_found:=found;
  select osp.* into op from workspaces w join organization_security_policies osp on osp.organization_id=w.organization_id where w.id=new.workspace_id;
  org_applies:=found and new.base_branch=any(op.protected_branches);
  if not repo_found and not org_applies then return new; end if;
  required_approvals:=greatest(case when repo_found then rp.required_approvals else 0 end,case when org_applies then op.min_branch_approvals else 0 end);
  required_human:=greatest(case when repo_found then rp.required_human_approvals else 0 end,case when org_applies then op.min_branch_human_approvals else 0 end);
  independent:=(repo_found and rp.require_independent_approval) or (org_applies and op.require_independent_review);
  verification_required:=(repo_found and rp.require_verification) or (org_applies and op.require_verification);
  actions_required:=(repo_found and rp.require_actions_success) or (org_applies and op.require_actions_success);
  block_changes:=(repo_found and rp.block_changes_requested) or (org_applies and op.block_changes_requested);
  ai_restricted:=(repo_found and rp.restrict_ai_merge) or (org_applies and op.restrict_ai_merge);
  select p.kind into merger_kind from principals p where p.id=current_setting('sessions.principal_id',true);
  if ai_restricted and merger_kind is not null and merger_kind<>'human' then raise exception 'effective branch policy requires human merge authority'; end if;
  select count(distinct r.reviewer_principal_id) into approval_count from pull_request_reviews r where r.pull_request_id=new.id and r.state='approved' and (not independent or r.reviewer_principal_id is distinct from new.author_principal_id);
  if approval_count<required_approvals then raise exception 'effective branch policy requires % approval(s); found %',required_approvals,approval_count; end if;
  select count(distinct r.reviewer_principal_id) into human_approval_count from pull_request_reviews r join principals p on p.id=r.reviewer_principal_id where r.pull_request_id=new.id and r.state='approved' and p.kind='human' and (not independent or r.reviewer_principal_id is distinct from new.author_principal_id);
  if human_approval_count<required_human then raise exception 'effective branch policy requires % human approval(s); found %',required_human,human_approval_count; end if;
  if block_changes then select count(*) into blocking_change_requests from pull_request_reviews r where r.pull_request_id=new.id and r.state='changes_requested'; if blocking_change_requests>0 then raise exception 'effective branch policy has unresolved changes-requested review(s)'; end if; end if;
  if verification_required and new.verification_state<>'passed' then raise exception 'effective branch policy requires passed verification'; end if;
  if actions_required then
    select count(*) into pending_runs from action_runs ar where ar.pull_request_id=new.id and ar.status<>'completed';
    select count(*) into failed_checks from action_checks ac join action_runs ar on ar.id=ac.action_run_id where ar.pull_request_id=new.id and (ac.status<>'completed' or coalesce(ac.conclusion,'failure')<>'success');
    if pending_runs>0 or failed_checks>0 then raise exception 'effective branch policy requires successful completed Actions'; end if;
  end if;
  select checkpoint_id into head_ref from sessions_repository_refs where repository_id=new.repository_id and ref_type='branch' and name=new.head_branch;
  if head_ref is distinct from new.head_commit_id then raise exception 'effective branch policy rejected stale pull request head'; end if;
  return new;
end;
$$ language plpgsql;

create or replace function sessions_validate_deployment_create() returns trigger as $$
declare
  checkpoint jsonb;
  release_record record;
  rp repository_environment_policies%rowtype;
  op organization_security_policies%rowtype;
  repo_found boolean:=false;
  org_applies boolean:=false;
  release_required boolean:=false;
  checkpoint_required boolean:=false;
begin
  select record into checkpoint from sessions_repository_checkpoints where repository_id=new.repository_id and checkpoint_id=new.commit_id;
  if checkpoint is null then raise exception 'deployment commit must identify a native Sessions checkpoint' using errcode='23514'; end if;
  new.source_digest:=checkpoint->>'sourceDigest';
  if new.release_id is not null then select * into release_record from repository_releases where id=new.release_id and repository_id=new.repository_id; if release_record.id is null then raise exception 'deployment release does not belong to repository' using errcode='23514'; end if; if release_record.commit_id<>new.commit_id or release_record.verification_state<>'verified' then raise exception 'deployment must match a verified release commit' using errcode='23514'; end if; end if;
  select * into rp from repository_environment_policies where repository_id=new.repository_id and environment=new.environment; repo_found:=found;
  select osp.* into op from hosted_repositories r join workspaces w on w.id=r.workspace_id join organization_security_policies osp on osp.organization_id=w.organization_id where r.id=new.repository_id; org_applies:=found and new.environment=any(op.protected_environments);
  release_required:=(repo_found and rp.require_release) or (org_applies and op.require_release);
  checkpoint_required:=(repo_found and rp.require_verified_checkpoint) or (org_applies and op.require_verified_checkpoint);
  if release_required and new.release_id is null then raise exception 'effective environment policy requires a verified release' using errcode='23514'; end if;
  if checkpoint_required and coalesce(checkpoint->>'lifecycle','draft') not in ('verified','reviewed','approved','published') then raise exception 'effective environment policy requires a verified checkpoint' using errcode='23514'; end if;
  return new;
end;
$$ language plpgsql;

create or replace function sessions_require_supply_chain_for_deployment() returns trigger as $$
declare
  rp repository_environment_policies%rowtype;
  op organization_security_policies%rowtype;
  repo_found boolean:=false;
  org_applies boolean:=false;
  attestation_required boolean:=false;
  sbom_required boolean:=false;
  attested integer:=0;
  sbom_count integer:=0;
begin
  select * into rp from repository_environment_policies where repository_id=new.repository_id and environment=new.environment; repo_found:=found;
  select osp.* into op from hosted_repositories r join workspaces w on w.id=r.workspace_id join organization_security_policies osp on osp.organization_id=w.organization_id where r.id=new.repository_id; org_applies:=found and new.environment=any(op.protected_environments);
  attestation_required:=(repo_found and rp.require_attested_artifact) or (org_applies and op.require_attested_artifact);
  sbom_required:=(repo_found and rp.require_sbom) or (org_applies and op.require_sbom);
  if attestation_required then select count(*) into attested from repository_artifacts a join artifact_attestations at on at.artifact_id=a.id where a.repository_id=new.repository_id and a.commit_id=new.commit_id and (new.release_id is null or a.release_id=new.release_id); if attested<1 then raise exception 'effective environment policy requires an attested build artifact' using errcode='23514'; end if; end if;
  if sbom_required then select count(*) into sbom_count from repository_artifacts a where a.repository_id=new.repository_id and a.commit_id=new.commit_id and a.sbom is not null and (new.release_id is null or a.release_id=new.release_id); if sbom_count<1 then raise exception 'effective environment policy requires an artifact SBOM' using errcode='23514'; end if; end if;
  return new;
end;
$$ language plpgsql;

create or replace function sessions_gate_deployment_transition() returns trigger as $$
declare
  rp repository_environment_policies%rowtype;
  op organization_security_policies%rowtype;
  repo_found boolean:=false;
  org_applies boolean:=false;
  required_approvals integer:=0;
  required_human integer:=0;
  independent boolean:=false;
  ai_restricted boolean:=false;
  approvals integer:=0;
  human_approvals integer:=0;
  rejections integer:=0;
begin
  if new.status not in ('running','success') or old.status in ('running','success') then return new; end if;
  select * into rp from repository_environment_policies where repository_id=new.repository_id and environment=new.environment; repo_found:=found;
  select osp.* into op from hosted_repositories r join workspaces w on w.id=r.workspace_id join organization_security_policies osp on osp.organization_id=w.organization_id where r.id=new.repository_id; org_applies:=found and new.environment=any(op.protected_environments);
  if not repo_found and not org_applies then return new; end if;
  required_approvals:=greatest(case when repo_found then rp.required_approvals else 0 end,case when org_applies then op.min_deployment_approvals else 0 end);
  required_human:=greatest(case when repo_found then rp.required_human_approvals else 0 end,case when org_applies then op.min_deployment_human_approvals else 0 end);
  independent:=(repo_found and rp.require_independent_approval) or (org_applies and op.require_independent_deployment_approval);
  ai_restricted:=(repo_found and rp.restrict_ai_deploy) or (org_applies and op.restrict_ai_deploy);
  select count(*) into approvals from deployment_approvals a where a.deployment_id=new.id and a.state='approved' and (not independent or a.reviewer_principal_id<>new.actor_principal_id);
  select count(*) into human_approvals from deployment_approvals a join principals p on p.id=a.reviewer_principal_id where a.deployment_id=new.id and a.state='approved' and p.kind='human' and (not independent or a.reviewer_principal_id<>new.actor_principal_id);
  select count(*) into rejections from deployment_approvals a where a.deployment_id=new.id and a.state='rejected';
  if rejections>0 then raise exception 'deployment has an active rejection' using errcode='23514'; end if;
  if approvals<required_approvals then raise exception 'effective environment policy deployment approvals not satisfied' using errcode='23514'; end if;
  if human_approvals<required_human then raise exception 'effective environment policy human approvals not satisfied' using errcode='23514'; end if;
  if ai_restricted and exists(select 1 from principals p where p.id=new.actor_principal_id and p.kind<>'human') then raise exception 'effective environment policy does not permit AI-initiated deployment' using errcode='23514'; end if;
  if new.status='running' and new.started_at is null then new.started_at:=now(); end if;
  if new.approved_at is null then new.approved_at:=now(); end if;
  return new;
end;
$$ language plpgsql;

commit;
