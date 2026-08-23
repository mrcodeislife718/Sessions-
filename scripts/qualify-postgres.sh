#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:=postgresql://sessions:sessions@localhost:5432/sessions}"
export DATABASE_URL
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
psql_cmd=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1)
migrations=(
  "$root/infrastructure/postgres/init.sql"
  "$root/infrastructure/postgres/002-hosted-repositories.sql"
  "$root/infrastructure/postgres/003-source-storage.sql"
  "$root/infrastructure/postgres/004-production-controls.sql"
  "$root/infrastructure/postgres/005-commercial-operations.sql"
  "$root/infrastructure/postgres/006-product-analytics.sql"
  "$root/infrastructure/postgres/007-billing-integrations.sql"
  "$root/infrastructure/postgres/008-repository-collaboration.sql"
  "$root/infrastructure/postgres/009-lifecycle-evidence-events.sql"
  "$root/infrastructure/postgres/010-hosted-auth.sql"
  "$root/infrastructure/postgres/011-repository-onboarding.sql"
  "$root/infrastructure/postgres/012-sessions-native-repository.sql"
)

for migration in "${migrations[@]}"; do "${psql_cmd[@]}" -f "$migration"; done
for migration in "${migrations[@]}"; do "${psql_cmd[@]}" -f "$migration"; done

"${psql_cmd[@]}" <<'SQL'
insert into organizations(id,name) values('org_qualification','Qualification Org') on conflict(id) do nothing;
insert into workspaces(id,organization_id,name) values('workspace_qualification','org_qualification','Qualification Workspace') on conflict(id) do nothing;
insert into principals(id,kind,display_name,email) values('principal_qualification','human','Qualification User','qualification@example.invalid') on conflict(id) do nothing;
insert into workspace_memberships(workspace_id,principal_id,role) values('workspace_qualification','principal_qualification','owner') on conflict do nothing;
insert into hosted_repositories(id,workspace_id,name,visibility,source_digest) values('repo_qualification','workspace_qualification','qualification-repo','private','sha256:native-qualification') on conflict(id) do update set source_digest=excluded.source_digest;
insert into workspace_entitlements(workspace_id,plan_key,status,source) values('workspace_qualification','developer','active','qualification') on conflict(workspace_id) do update set plan_key='developer',status='active',source='qualification',updated_at=now();
insert into sessions(id,workspace_id,project_id,repository_id,objective) values('session_qualification','workspace_qualification','project_qualification','repo_qualification','prove persistence') on conflict(id) do nothing;
insert into session_events(id,session_id,type,occurred_at,actor,payload) values('event_qualification','session_qualification','SessionStarted',now(),'{"id":"principal_qualification","kind":"human","displayName":"Qualification User"}','{"objective":"prove persistence"}') on conflict(id) do nothing;
insert into snapshots(id,session_id,repository_id,digest,manifest,created_at) values('snapshot_qualification','session_qualification','repo_qualification','sha256:qualification','{"entries":[]}',now()) on conflict(id) do nothing;
insert into verifications(id,session_id,snapshot_id,kind,status,summary,requested_by,started_at,finished_at) values('verification_qualification','session_qualification','snapshot_qualification','qualification','passed','database persistence verified','{"id":"principal_qualification","kind":"human","displayName":"Qualification User"}',now(),now()) on conflict(id) do nothing;
insert into billing_accounts(id,workspace_id,plan_key,status,external_provider,payment_state) values('billing_qualification','workspace_qualification','developer','active','stripe','ok') on conflict(id) do nothing;
insert into subscriptions(id,billing_account_id,plan_key,status,seats,external_subscription_ref) values('subscription_qualification','billing_qualification','developer','active',1,'sub_qualification') on conflict(id) do nothing;
insert into stripe_events(id,event_type,livemode,payload) values('evt_qualification','invoice.paid',false,'{"id":"evt_qualification","type":"invoice.paid"}') on conflict(id) do nothing;
insert into usage_events(id,billing_account_id,workspace_id,repository_id,session_id,dimension,quantity,unit,idempotency_key) values('usage_qualification','billing_qualification','workspace_qualification','repo_qualification','session_qualification','runner_seconds',1,'second','qualification-usage') on conflict(id) do nothing;
insert into audit_events(id,workspace_id,principal_id,request_id,action,resource_type,resource_id,outcome) values('audit_qualification','workspace_qualification','principal_qualification','request_qualification','session.create','session','session_qualification','allowed') on conflict(id) do nothing;
insert into product_events(id,workspace_id,principal_id,event_name,session_id,repository_id,properties) values('product_qualification','workspace_qualification','principal_qualification','recovery_completed','session_qualification','repo_qualification','{"source":"qualification"}') on conflict(id) do nothing;
insert into recovery_experiments(id,workspace_id,session_id,experiment_kind,baseline_kind,orientation_ms,missing_context_count,reproduction_success,continuation_ready,reconstruction_accuracy) values('recovery_qualification','workspace_qualification','session_qualification','cross_environment','git_plus_chat',1,0,true,true,1.0) on conflict(id) do nothing;
insert into workspace_limits(workspace_id,hosted_repository_limit,runner_seconds_monthly_limit,storage_bytes_limit) values('workspace_qualification',10,10000,1073741824) on conflict(workspace_id) do nothing;
insert into repository_issues(workspace_id,repository_id,number,title,body,author_principal_id) values('workspace_qualification','repo_qualification',1,'Qualification issue','prove issue persistence','principal_qualification') on conflict(repository_id,number) do nothing;
insert into pull_requests(workspace_id,repository_id,number,title,base_branch,head_branch,head_commit_id,author_principal_id,verification_state) values('workspace_qualification','repo_qualification',1,'Qualification PR','main','feature','cp_qualification','principal_qualification','passed') on conflict(repository_id,number) do nothing;
insert into repository_releases(workspace_id,repository_id,tag_name,name,commit_id,author_principal_id,published_at) values('workspace_qualification','repo_qualification','v0.0.qualification','Qualification Release','cp_qualification','principal_qualification',now()) on conflict(repository_id,tag_name) do nothing;

insert into sessions_repository_checkpoints(repository_id,checkpoint_id,record) values('repo_qualification','cp_native_qualification','{"id":"cp_native_qualification","friendlyName":"Native qualification commit","sourceManifestId":"manifest_native_qualification","sourceDigest":"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824","lifecycle":"verified","recovery":{"reconstructable":true,"verified":true},"createdAt":"2026-08-19T00:00:00.000Z"}') on conflict(repository_id,checkpoint_id) do update set record=excluded.record;
insert into repository_manifests(id,repository_id,source_digest,manifest) values('manifest_native_qualification','repo_qualification','2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824','{"version":1,"id":"manifest_native_qualification","repositoryId":"repo_qualification","sourceDigest":"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824","entries":[{"path":"hello.txt","digest":"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824","objectId":"obj_2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824","size":5}]}') on conflict(id) do update set manifest=excluded.manifest,source_digest=excluded.source_digest;
insert into sessions_repository_objects(repository_id,object_id,digest,size_bytes,content) values('repo_qualification','obj_2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824','2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',5,convert_to('hello','UTF8')) on conflict(repository_id,object_id) do nothing;
insert into sessions_repository_refs(repository_id,ref_type,name,checkpoint_id,metadata) values('repo_qualification','branch','main','cp_native_qualification','{"id":"ws_native_main"}') on conflict(repository_id,ref_type,name) do update set checkpoint_id=excluded.checkpoint_id,metadata=excluded.metadata,updated_at=now();
insert into sessions_repository_states(repository_id,state) values('repo_qualification','{"repository":{"id":"repo_qualification","name":"qualification-repo"},"state":{"activeWorkstreamId":"ws_native_main"},"branches":[{"id":"ws_native_main","repositoryId":"repo_qualification","name":"main","headCheckpointId":"cp_native_qualification"}],"tags":[]}') on conflict(repository_id) do update set state=excluded.state,updated_at=now();

DO $$
BEGIN
  IF (select count(*) from sessions where id='session_qualification') <> 1 THEN RAISE EXCEPTION 'session persistence assertion failed'; END IF;
  IF (select count(*) from session_events where session_id='session_qualification') < 1 THEN RAISE EXCEPTION 'event persistence assertion failed'; END IF;
  IF (select count(*) from workspace_memberships where workspace_id='workspace_qualification') <> 1 THEN RAISE EXCEPTION 'tenancy assertion failed'; END IF;
  IF (select count(*) from recovery_experiments where continuation_ready is true) < 1 THEN RAISE EXCEPTION 'recovery proof assertion failed'; END IF;
  IF (select count(*) from repository_issues where repository_id='repo_qualification') <> 1 THEN RAISE EXCEPTION 'issue persistence assertion failed'; END IF;
  IF (select count(*) from pull_requests where repository_id='repo_qualification') <> 1 THEN RAISE EXCEPTION 'pull request persistence assertion failed'; END IF;
  IF (select count(*) from sessions_repository_checkpoints where repository_id='repo_qualification') <> 1 THEN RAISE EXCEPTION 'native checkpoint persistence assertion failed'; END IF;
  IF (select count(*) from sessions_repository_refs where repository_id='repo_qualification' and name='main') <> 1 THEN RAISE EXCEPTION 'native ref persistence assertion failed'; END IF;
  IF (select count(*) from sessions_repository_objects where repository_id='repo_qualification' and digest='2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824' and convert_from(content,'UTF8')='hello') <> 1 THEN RAISE EXCEPTION 'native object persistence/integrity assertion failed'; END IF;
  IF (select count(*) from sessions_repository_states where repository_id='repo_qualification') <> 1 THEN RAISE EXCEPTION 'native repository state assertion failed'; END IF;
END $$;
SQL

backup_dir="$(mktemp -d -t sessions-qualification.XXXXXX)"
backup="$backup_dir/sessions.dump"
trap 'rm -rf "$backup_dir"' EXIT
server_major="$(psql "$DATABASE_URL" -Atc "show server_version_num" | awk '{print int($1/10000)}')"
client_major="$(pg_dump --version | awk '{print $NF}' | cut -d. -f1)"
host_uid="$(id -u)"; host_gid="$(id -g)"

pg_dump_matched() {
  if [[ "$server_major" == "$client_major" ]]; then pg_dump "$DATABASE_URL" --format=custom --file="$backup";
  elif command -v docker >/dev/null 2>&1; then
    local dir file; dir="$(dirname "$backup")"; file="$(basename "$backup")"
    docker run --rm --user "$host_uid:$host_gid" --network host -e PGPASSWORD="${PGPASSWORD:-}" -v "$dir:/backup" "postgres:${server_major}" pg_dump "$DATABASE_URL" --format=custom --file="/backup/$file"
  else echo "pg_dump major version mismatch and Docker unavailable" >&2; exit 1; fi
}
pg_restore_matched() {
  local restore_url="$1"
  if [[ "$server_major" == "$client_major" ]]; then pg_restore --no-owner --no-privileges --dbname="$restore_url" "$backup";
  elif command -v docker >/dev/null 2>&1; then
    local dir file; dir="$(dirname "$backup")"; file="$(basename "$backup")"
    docker run --rm --user "$host_uid:$host_gid" --network host -e PGPASSWORD="${PGPASSWORD:-}" -v "$dir:/backup:ro" "postgres:${server_major}" pg_restore --no-owner --no-privileges --dbname="$restore_url" "/backup/$file"
  else echo "pg_restore major version mismatch and Docker unavailable" >&2; exit 1; fi
}

pg_dump_matched
test -s "$backup"
restore_db="sessions_restore_qualification"
admin_url="${DATABASE_URL%/*}/postgres"
restore_url="${DATABASE_URL%/*}/$restore_db"
psql "$admin_url" -v ON_ERROR_STOP=1 -c "drop database if exists $restore_db with (force);" -c "create database $restore_db;"
pg_restore_matched "$restore_url"
psql "$restore_url" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF (select count(*) from sessions where id='session_qualification') <> 1 THEN RAISE EXCEPTION 'restored session assertion failed'; END IF;
  IF (select count(*) from repository_issues where repository_id='repo_qualification') <> 1 THEN RAISE EXCEPTION 'restored issue assertion failed'; END IF;
  IF (select count(*) from pull_requests where repository_id='repo_qualification') <> 1 THEN RAISE EXCEPTION 'restored PR assertion failed'; END IF;
  IF (select count(*) from repository_releases where repository_id='repo_qualification') <> 1 THEN RAISE EXCEPTION 'restored release assertion failed'; END IF;
  IF (select count(*) from sessions_repository_checkpoints where repository_id='repo_qualification' and checkpoint_id='cp_native_qualification') <> 1 THEN RAISE EXCEPTION 'restored native checkpoint assertion failed'; END IF;
  IF (select count(*) from sessions_repository_refs where repository_id='repo_qualification' and ref_type='branch' and name='main') <> 1 THEN RAISE EXCEPTION 'restored native ref assertion failed'; END IF;
  IF (select count(*) from sessions_repository_objects where repository_id='repo_qualification' and convert_from(content,'UTF8')='hello') <> 1 THEN RAISE EXCEPTION 'restored native object assertion failed'; END IF;
  IF (select count(*) from sessions_repository_states where repository_id='repo_qualification') <> 1 THEN RAISE EXCEPTION 'restored native state assertion failed'; END IF;
END $$;
SQL
printf 'PostgreSQL qualification passed: migrations, Sessions-native source control, collaboration, persistence, backup, and independent restore verified.\n'
