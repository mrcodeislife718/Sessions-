begin;

create table if not exists repository_branch_policies (
  workspace_id text not null references workspaces(id) on delete cascade,
  repository_id text not null,
  branch_name text not null,
  required_approvals integer not null default 1 check (required_approvals >= 0),
  required_human_approvals integer not null default 0 check (required_human_approvals >= 0),
  require_independent_approval boolean not null default true,
  require_verification boolean not null default true,
  require_actions_success boolean not null default true,
  block_changes_requested boolean not null default true,
  restrict_ai_merge boolean not null default false,
  created_by text references principals(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (repository_id, branch_name),
  check (required_human_approvals <= required_approvals or required_approvals = 0)
);
create index if not exists repository_branch_policies_workspace_repo_idx
  on repository_branch_policies(workspace_id, repository_id, branch_name);

create or replace function sessions_enforce_pull_request_merge_policy() returns trigger as $$
declare
  policy repository_branch_policies%rowtype;
  approval_count integer;
  human_approval_count integer;
  blocking_change_requests integer;
  pending_runs integer;
  failed_checks integer;
  head_ref text;
  merger_kind text;
begin
  if new.state <> 'merged' or old.state = 'merged' then return new; end if;

  select * into policy
  from repository_branch_policies
  where workspace_id = new.workspace_id
    and repository_id = new.repository_id
    and branch_name = new.base_branch;

  if not found then return new; end if;

  select p.kind into merger_kind from principals p where p.id = current_setting('sessions.principal_id', true);
  if policy.restrict_ai_merge and merger_kind in ('ai_agent','ai_system','ai_worker') then
    raise exception 'protected branch policy requires human merge authority';
  end if;

  select count(distinct r.reviewer_principal_id) into approval_count
  from pull_request_reviews r
  where r.pull_request_id = new.id
    and r.state = 'approved'
    and (not policy.require_independent_approval or r.reviewer_principal_id is distinct from new.author_principal_id);

  if approval_count < policy.required_approvals then
    raise exception 'protected branch requires % independent approval(s); found %', policy.required_approvals, approval_count;
  end if;

  if policy.required_human_approvals > 0 then
    select count(distinct r.reviewer_principal_id) into human_approval_count
    from pull_request_reviews r
    join principals p on p.id = r.reviewer_principal_id
    where r.pull_request_id = new.id
      and r.state = 'approved'
      and p.kind = 'human'
      and (not policy.require_independent_approval or r.reviewer_principal_id is distinct from new.author_principal_id);
    if human_approval_count < policy.required_human_approvals then
      raise exception 'protected branch requires % human approval(s); found %', policy.required_human_approvals, human_approval_count;
    end if;
  end if;

  if policy.block_changes_requested then
    select count(*) into blocking_change_requests
    from pull_request_reviews r
    where r.pull_request_id = new.id and r.state = 'changes_requested';
    if blocking_change_requests > 0 then
      raise exception 'protected branch has unresolved changes-requested review(s)';
    end if;
  end if;

  if policy.require_verification and new.verification_state <> 'passed' then
    raise exception 'protected branch requires passed verification';
  end if;

  if policy.require_actions_success then
    select count(*) into pending_runs
    from action_runs ar
    where ar.pull_request_id = new.id and ar.status <> 'completed';
    if pending_runs > 0 then
      raise exception 'protected branch has pending Actions runs';
    end if;

    select count(*) into failed_checks
    from action_checks ac
    join action_runs ar on ar.id = ac.action_run_id
    where ar.pull_request_id = new.id
      and (ac.status <> 'completed' or coalesce(ac.conclusion,'failure') <> 'success');
    if failed_checks > 0 then
      raise exception 'protected branch has incomplete or unsuccessful Actions checks';
    end if;
  end if;

  select checkpoint_id into head_ref
  from sessions_repository_refs
  where repository_id = new.repository_id and ref_type = 'branch' and name = new.head_branch;
  if head_ref is distinct from new.head_commit_id then
    raise exception 'protected branch rejected stale pull request head';
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_sessions_enforce_pull_request_merge_policy on pull_requests;
create trigger trg_sessions_enforce_pull_request_merge_policy
before update of state on pull_requests
for each row execute function sessions_enforce_pull_request_merge_policy();

commit;
