begin;

create table if not exists repository_artifacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references workspaces(id) on delete cascade,
  repository_id text not null references hosted_repositories(id) on delete cascade,
  commit_id text not null,
  action_run_id uuid references action_runs(id) on delete set null,
  release_id uuid references repository_releases(id) on delete set null,
  name text not null,
  media_type text not null default 'application/octet-stream',
  size_bytes bigint not null check (size_bytes >= 0),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  storage_key text,
  sbom jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by text references principals(id),
  created_at timestamptz not null default now(),
  unique(repository_id,sha256)
);
create index if not exists repository_artifacts_commit_idx on repository_artifacts(workspace_id,repository_id,commit_id,created_at desc);
create index if not exists repository_artifacts_release_idx on repository_artifacts(release_id) where release_id is not null;

create table if not exists artifact_attestations (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references repository_artifacts(id) on delete cascade,
  predicate_type text not null,
  statement jsonb not null,
  signer_principal_id text references principals(id),
  signature_algorithm text not null check (signature_algorithm in ('ed25519','ecdsa-p256-sha256','rsa-pss-sha256','hmac-sha256')),
  signature text not null,
  public_key_fingerprint text,
  created_at timestamptz not null default now(),
  unique(artifact_id,predicate_type,signer_principal_id)
);
create index if not exists artifact_attestations_artifact_idx on artifact_attestations(artifact_id,created_at desc);

alter table repository_environment_policies add column if not exists require_attested_artifact boolean not null default false;
alter table repository_environment_policies add column if not exists require_sbom boolean not null default false;

create or replace function sessions_validate_repository_artifact() returns trigger as $$
declare
  checkpoint jsonb;
  run_record record;
  release_record record;
begin
  select record into checkpoint from sessions_repository_checkpoints where repository_id=new.repository_id and checkpoint_id=new.commit_id;
  if checkpoint is null then raise exception 'artifact commit must identify a native Sessions checkpoint' using errcode='23514'; end if;
  if new.action_run_id is not null then
    select * into run_record from action_runs where id=new.action_run_id;
    if run_record.id is null or run_record.repository_id<>new.repository_id or run_record.commit_id is distinct from new.commit_id then
      raise exception 'artifact Actions run must belong to the same repository and commit' using errcode='23514';
    end if;
    if run_record.status<>'completed' or run_record.conclusion<>'success' then
      raise exception 'artifact Actions run must have completed successfully' using errcode='23514';
    end if;
  end if;
  if new.release_id is not null then
    select * into release_record from repository_releases where id=new.release_id;
    if release_record.id is null or release_record.repository_id<>new.repository_id or release_record.commit_id<>new.commit_id or release_record.verification_state<>'verified' then
      raise exception 'artifact release must be a verified release for the same repository and commit' using errcode='23514';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_sessions_validate_repository_artifact on repository_artifacts;
create trigger trg_sessions_validate_repository_artifact before insert or update of repository_id,commit_id,action_run_id,release_id on repository_artifacts for each row execute function sessions_validate_repository_artifact();

create or replace function sessions_require_supply_chain_for_deployment() returns trigger as $$
declare
  policy repository_environment_policies%rowtype;
  attested integer:=0;
  sbom_count integer:=0;
begin
  select * into policy from repository_environment_policies where repository_id=new.repository_id and environment=new.environment;
  if not found then return new; end if;
  if policy.require_attested_artifact then
    select count(*) into attested
      from repository_artifacts a join artifact_attestations at on at.artifact_id=a.id
      where a.repository_id=new.repository_id and a.commit_id=new.commit_id
        and (new.release_id is null or a.release_id=new.release_id);
    if attested<1 then raise exception 'environment requires an attested build artifact' using errcode='23514'; end if;
  end if;
  if policy.require_sbom then
    select count(*) into sbom_count from repository_artifacts a
      where a.repository_id=new.repository_id and a.commit_id=new.commit_id and a.sbom is not null
        and (new.release_id is null or a.release_id=new.release_id);
    if sbom_count<1 then raise exception 'environment requires an artifact SBOM' using errcode='23514'; end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_sessions_require_supply_chain_for_deployment on repository_deployments;
create trigger trg_sessions_require_supply_chain_for_deployment before insert or update of commit_id,release_id,environment on repository_deployments for each row execute function sessions_require_supply_chain_for_deployment();

commit;
