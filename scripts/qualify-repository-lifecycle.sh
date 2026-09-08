#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:=postgresql://sessions:sessions@localhost:5432/sessions}"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
delete from hosted_repositories where id='repo_lifecycle_qualification';
insert into hosted_repositories(id,workspace_id,name,visibility) values('repo_lifecycle_qualification','workspace_qualification','lifecycle-qualification','private');
insert into repository_issues(workspace_id,repository_id,number,title,body,author_principal_id) values('workspace_qualification','repo_lifecycle_qualification',1,'before archive','writable while active','principal_qualification');
update hosted_repositories set lifecycle_status='archived',archived_at=now(),lifecycle_updated_by='principal_qualification' where id='repo_lifecycle_qualification';
DO $$
BEGIN
  BEGIN
    insert into repository_issues(workspace_id,repository_id,number,title,body,author_principal_id) values('workspace_qualification','repo_lifecycle_qualification',2,'blocked','must fail','principal_qualification');
    raise exception 'archived repository write assertion failed';
  EXCEPTION WHEN OTHERS THEN
    if sqlerrm='archived repository write assertion failed' then raise; end if;
  END;
END $$;
update hosted_repositories set lifecycle_status='active',archived_at=null where id='repo_lifecycle_qualification';
insert into repository_issues(workspace_id,repository_id,number,title,body,author_principal_id) values('workspace_qualification','repo_lifecycle_qualification',2,'after restore','writable after restore','principal_qualification');
update hosted_repositories set lifecycle_status='deletion_scheduled',deletion_scheduled_at=now(),purge_after=now()+interval '30 days' where id='repo_lifecycle_qualification';
DO $$
BEGIN
  BEGIN
    insert into sessions_repository_checkpoints(repository_id,checkpoint_id,record) values('repo_lifecycle_qualification','cp_should_fail','{"id":"cp_should_fail"}');
    raise exception 'deletion scheduled native write assertion failed';
  EXCEPTION WHEN OTHERS THEN
    if sqlerrm='deletion scheduled native write assertion failed' then raise; end if;
  END;
END $$;
begin;
select set_config('sessions.lifecycle_purge','on',true);
delete from repository_issues where repository_id='repo_lifecycle_qualification';
delete from hosted_repositories where id='repo_lifecycle_qualification';
commit;
DO $$
BEGIN
  IF exists(select 1 from hosted_repositories where id='repo_lifecycle_qualification') THEN RAISE EXCEPTION 'repository purge bypass assertion failed'; END IF;
END $$;
SQL
printf 'Repository lifecycle qualification passed against current canonical schema: active writes, archive read-only state, restore, deletion quarantine and controlled purge bypass verified.\n'
