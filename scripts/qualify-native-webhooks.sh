#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:=postgresql://sessions:sessions@localhost:5432/sessions}"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f infrastructure/postgres/021-native-repository-webhook-events.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
update repository_webhooks set events=array['*']::text[] where repository_id='repo_qualification';
delete from sessions_repository_refs where repository_id='repo_qualification' and ref_type='branch' and name='webhook-qualification';
delete from sessions_repository_checkpoints where repository_id='repo_qualification' and checkpoint_id='cp_webhook_qualification';

insert into sessions_repository_checkpoints(repository_id,checkpoint_id,record)
values('repo_qualification','cp_webhook_qualification','{"id":"cp_webhook_qualification","friendlyName":"Webhook qualification checkpoint","repositoryId":"repo_qualification","workstreamId":"ws_webhook_qualification","parentCheckpointIds":["cp_native_qualification"],"sourceManifestId":"manifest_native_qualification","sourceDigest":"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824","lifecycle":"verified","actorIds":["principal_qualification"],"sessionIds":[],"verificationIds":[],"approvalIds":[],"recovery":{"reconstructable":true,"verified":true},"createdAt":"2026-09-08T00:00:00.000Z"}');
insert into sessions_repository_refs(repository_id,ref_type,name,checkpoint_id,metadata)
values('repo_qualification','branch','webhook-qualification','cp_webhook_qualification','{"id":"ws_webhook_qualification"}');
update sessions_repository_refs set checkpoint_id='cp_native_qualification',updated_at=now() where repository_id='repo_qualification' and ref_type='branch' and name='webhook-qualification';
delete from sessions_repository_refs where repository_id='repo_qualification' and ref_type='branch' and name='webhook-qualification';

DO $$
BEGIN
  IF (select count(*) from webhook_events where repository_id='repo_qualification' and event_name='checkpoint.insert' and aggregate_id='cp_webhook_qualification') <> 1 THEN RAISE EXCEPTION 'checkpoint webhook assertion failed'; END IF;
  IF (select count(*) from webhook_events where repository_id='repo_qualification' and event_name='branch.insert' and aggregate_id='webhook-qualification') <> 1 THEN RAISE EXCEPTION 'branch insert webhook assertion failed'; END IF;
  IF (select count(*) from webhook_events where repository_id='repo_qualification' and event_name='branch.update' and aggregate_id='webhook-qualification') <> 1 THEN RAISE EXCEPTION 'branch update webhook assertion failed'; END IF;
  IF (select count(*) from webhook_events where repository_id='repo_qualification' and event_name='branch.delete' and aggregate_id='webhook-qualification') <> 1 THEN RAISE EXCEPTION 'branch delete webhook assertion failed'; END IF;
  IF (select count(*) from webhook_deliveries d join webhook_events e on e.id=d.event_id where e.repository_id='repo_qualification' and e.event_name in ('checkpoint.insert','branch.insert','branch.update','branch.delete')) < 4 THEN RAISE EXCEPTION 'native webhook delivery enqueue assertion failed'; END IF;
END $$;
SQL
printf 'Native repository webhook qualification passed: checkpoint and branch lifecycle events are transactionally queued.\n'
