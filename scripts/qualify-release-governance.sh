#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:=postgresql://sessions:sessions@localhost:5432/sessions}"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f infrastructure/postgres/020-release-deployment-governance.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  BEGIN
    insert into repository_releases(workspace_id,repository_id,tag_name,name,commit_id,author_principal_id,published_at)
    values('workspace_qualification','repo_qualification','v0.0.invalid','Invalid release','cp_missing','principal_qualification',now());
    raise exception 'invalid release checkpoint assertion failed';
  EXCEPTION WHEN OTHERS THEN
    if sqlerrm='invalid release checkpoint assertion failed' then raise; end if;
  END;
END $$;

insert into repository_releases(workspace_id,repository_id,tag_name,name,commit_id,body,author_principal_id,published_at)
values('workspace_qualification','repo_qualification','v0.0.governed','Governed release','cp_native_qualification','verified release qualification','principal_qualification',now())
on conflict(repository_id,tag_name) do update set commit_id=excluded.commit_id,body=excluded.body;

insert into repository_environment_policies(workspace_id,repository_id,environment,require_release,require_verified_checkpoint,required_approvals,required_human_approvals,require_independent_approval,restrict_ai_deploy,created_by)
values('workspace_qualification','repo_qualification','production',true,true,1,1,true,false,'principal_qualification')
on conflict(repository_id,environment) do update set require_release=true,require_verified_checkpoint=true,required_approvals=1,required_human_approvals=1,require_independent_approval=true,restrict_ai_deploy=false,updated_at=now();

insert into repository_deployments(id,workspace_id,repository_id,release_id,commit_id,environment,status,evidence,actor_principal_id)
select '00000000-0000-0000-0000-000000000301','workspace_qualification','repo_qualification',id,'cp_native_qualification','production','queued','{"qualification":true}','principal_qualification'
from repository_releases where repository_id='repo_qualification' and tag_name='v0.0.governed'
on conflict(id) do update set status='queued',actor_principal_id='principal_qualification';

DO $$
BEGIN
  BEGIN
    update repository_deployments set status='running' where id='00000000-0000-0000-0000-000000000301';
    raise exception 'unapproved deployment transition assertion failed';
  EXCEPTION WHEN OTHERS THEN
    if sqlerrm='unapproved deployment transition assertion failed' then raise; end if;
  END;
END $$;

insert into deployment_approvals(deployment_id,reviewer_principal_id,state,body)
values('00000000-0000-0000-0000-000000000301','principal_reviewer','approved','independent human production approval')
on conflict(deployment_id,reviewer_principal_id) do update set state='approved',body=excluded.body,updated_at=now();
update repository_deployments set status='running' where id='00000000-0000-0000-0000-000000000301';
update repository_deployments set status='success',completed_at=now() where id='00000000-0000-0000-0000-000000000301';

insert into repository_deployments(id,workspace_id,repository_id,release_id,commit_id,environment,status,evidence,actor_principal_id)
select '00000000-0000-0000-0000-000000000302','workspace_qualification','repo_qualification',id,'cp_native_qualification','production','queued','{"qualification":"self-approval"}','principal_qualification'
from repository_releases where repository_id='repo_qualification' and tag_name='v0.0.governed'
on conflict(id) do update set status='queued',actor_principal_id='principal_qualification';
insert into deployment_approvals(deployment_id,reviewer_principal_id,state,body)
values('00000000-0000-0000-0000-000000000302','principal_qualification','approved','self approval must not count')
on conflict(deployment_id,reviewer_principal_id) do update set state='approved',body=excluded.body,updated_at=now();
DO $$
BEGIN
  BEGIN
    update repository_deployments set status='running' where id='00000000-0000-0000-0000-000000000302';
    raise exception 'deployment self-approval rejection assertion failed';
  EXCEPTION WHEN OTHERS THEN
    if sqlerrm='deployment self-approval rejection assertion failed' then raise; end if;
  END;
END $$;

DO $$
BEGIN
  IF (select verification_state from repository_releases where repository_id='repo_qualification' and tag_name='v0.0.governed') <> 'verified' THEN RAISE EXCEPTION 'release verification assertion failed'; END IF;
  IF (select source_digest from repository_releases where repository_id='repo_qualification' and tag_name='v0.0.governed') is null THEN RAISE EXCEPTION 'release source digest assertion failed'; END IF;
  IF (select status from repository_deployments where id='00000000-0000-0000-0000-000000000301') <> 'success' THEN RAISE EXCEPTION 'approved deployment assertion failed'; END IF;
  IF (select approved_at from repository_deployments where id='00000000-0000-0000-0000-000000000301') is null THEN RAISE EXCEPTION 'deployment approval timestamp assertion failed'; END IF;
  IF (select status from repository_deployments where id='00000000-0000-0000-0000-000000000302') <> 'queued' THEN RAISE EXCEPTION 'self-approved deployment was not blocked'; END IF;
END $$;
SQL
printf 'Release/deployment governance qualification passed: native release integrity, protected environment approval, independent human review and self-approval rejection verified.\n'
