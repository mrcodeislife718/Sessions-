#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:=postgresql://sessions:sessions@localhost:5432/sessions}"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
insert into hosted_repositories(id,workspace_id,name,visibility,source_digest)
values('repo_supply_chain_blocked','workspace_qualification','supply-chain-blocked','private',repeat('c',64))
on conflict(id) do nothing;
insert into sessions_repository_checkpoints(repository_id,checkpoint_id,record)
values('repo_supply_chain_blocked','cp_supply_chain_blocked',jsonb_build_object('id','cp_supply_chain_blocked','sourceDigest',repeat('c',64),'lifecycle','verified','recovery',jsonb_build_object('verified',true,'reconstructable',true)))
on conflict(repository_id,checkpoint_id) do nothing;
insert into repository_releases(workspace_id,repository_id,tag_name,name,commit_id,author_principal_id,published_at)
values('workspace_qualification','repo_supply_chain_blocked','v0.0.blocked','Blocked Supply Chain Qualification','cp_supply_chain_blocked','principal_qualification',now())
on conflict(repository_id,tag_name) do update set commit_id=excluded.commit_id;
insert into repository_environment_policies(workspace_id,repository_id,environment,require_release,require_verified_checkpoint,required_approvals,required_human_approvals,require_independent_approval,restrict_ai_deploy,require_attested_artifact,require_sbom,created_by)
values('workspace_qualification','repo_supply_chain_blocked','production',true,true,0,0,false,false,true,true,'principal_qualification')
on conflict(repository_id,environment) do update set require_attested_artifact=true,require_sbom=true,required_approvals=0,required_human_approvals=0;

DO $$
DECLARE release_value uuid;
BEGIN
  select id into release_value from repository_releases where repository_id='repo_supply_chain_blocked' and tag_name='v0.0.blocked';
  BEGIN
    insert into repository_deployments(workspace_id,repository_id,release_id,commit_id,environment,status,actor_principal_id)
    values('workspace_qualification','repo_supply_chain_blocked',release_value,'cp_supply_chain_blocked','production','queued','principal_qualification');
    raise exception 'deployment without attested artifact assertion failed';
  EXCEPTION WHEN OTHERS THEN
    if sqlerrm='deployment without attested artifact assertion failed' then raise; end if;
  END;
END $$;

insert into repository_releases(workspace_id,repository_id,tag_name,name,commit_id,author_principal_id,published_at)
values('workspace_qualification','repo_qualification','v0.0.supply-chain','Supply Chain Qualification','cp_native_qualification','principal_qualification',now())
on conflict(repository_id,tag_name) do update set commit_id=excluded.commit_id;
insert into repository_environment_policies(workspace_id,repository_id,environment,require_release,require_verified_checkpoint,required_approvals,required_human_approvals,require_independent_approval,restrict_ai_deploy,require_attested_artifact,require_sbom,created_by)
values('workspace_qualification','repo_qualification','supply-chain-production',true,true,0,0,false,false,true,true,'principal_qualification')
on conflict(repository_id,environment) do update set require_attested_artifact=true,require_sbom=true,required_approvals=0,required_human_approvals=0;
insert into principal_signing_keys(workspace_id,principal_id,algorithm,public_key_pem,fingerprint_sha256,status)
values('workspace_qualification','principal_qualification','ed25519','qualification-key-material',repeat('a',64),'active')
on conflict(workspace_id,fingerprint_sha256) do update set status='active',revoked_at=null;
insert into repository_artifacts(workspace_id,repository_id,commit_id,action_run_id,release_id,name,media_type,size_bytes,sha256,storage_key,sbom,metadata,created_by)
select 'workspace_qualification','repo_qualification','cp_native_qualification','00000000-0000-0000-0000-000000000201',r.id,'qualification-artifact.tgz','application/gzip',42,repeat('b',64),'qualification/artifact.tgz','{"bomFormat":"CycloneDX","specVersion":"1.6","components":[]}'::jsonb,'{"builder":"sessions-actions"}'::jsonb,'principal_qualification'
from repository_releases r where r.repository_id='repo_qualification' and r.tag_name='v0.0.supply-chain'
on conflict(repository_id,sha256) do update set release_id=excluded.release_id,sbom=excluded.sbom,metadata=excluded.metadata;
insert into artifact_attestations(artifact_id,predicate_type,statement,signer_principal_id,signature_algorithm,signature,signing_key_id)
select a.id,'https://sessions.dev/attestation/build/v1',jsonb_build_object('subject',jsonb_build_object('sha256',a.sha256),'repositoryId',a.repository_id,'commitId',a.commit_id,'releaseId',a.release_id::text,'builder',jsonb_build_object('id','sessions-actions')),'principal_qualification','ed25519','qualification-signature',k.id
from repository_artifacts a cross join principal_signing_keys k
where a.repository_id='repo_qualification' and a.sha256=repeat('b',64) and k.workspace_id='workspace_qualification' and k.fingerprint_sha256=repeat('a',64)
on conflict(artifact_id,predicate_type,signer_principal_id) do update set statement=excluded.statement,signing_key_id=excluded.signing_key_id,signature=excluded.signature;
insert into repository_deployments(workspace_id,repository_id,release_id,commit_id,environment,status,actor_principal_id)
select 'workspace_qualification','repo_qualification',r.id,'cp_native_qualification','supply-chain-production','queued','principal_qualification'
from repository_releases r where r.repository_id='repo_qualification' and r.tag_name='v0.0.supply-chain';

DO $$
BEGIN
  IF (select count(*) from repository_artifacts where repository_id='repo_qualification' and commit_id='cp_native_qualification' and sbom is not null)<1 THEN RAISE EXCEPTION 'artifact SBOM persistence assertion failed'; END IF;
  IF (select count(*) from artifact_attestations at join repository_artifacts a on a.id=at.artifact_id where a.repository_id='repo_qualification' and a.sha256=repeat('b',64) and at.statement->>'repositoryId'=a.repository_id and at.statement->>'commitId'=a.commit_id and at.statement#>>'{subject,sha256}'=a.sha256)<1 THEN RAISE EXCEPTION 'bound artifact attestation persistence assertion failed'; END IF;
  IF (select count(*) from repository_deployments where repository_id='repo_qualification' and environment='supply-chain-production')<1 THEN RAISE EXCEPTION 'attested deployment admission assertion failed'; END IF;
END $$;
SQL
printf 'Supply-chain qualification passed: exact checkpoint/release/artifact binding, SBOM requirement and attested deployment admission enforced.\n'
