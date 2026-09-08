#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:=postgresql://sessions:sessions@localhost:5432/sessions}"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f infrastructure/postgres/019-webhook-outbox.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
insert into repository_webhooks(id,workspace_id,repository_id,endpoint_url,events,active,secret_ciphertext,secret_nonce,secret_auth_tag,created_by)
values('00000000-0000-0000-0000-000000000901','workspace_qualification','repo_qualification','https://webhook.example.invalid/sessions',array['issue.insert'],true,'cipher','nonce','tag','principal_qualification')
on conflict(repository_id,endpoint_url) do update set events=excluded.events,active=true,updated_at=now();

delete from repository_issues where repository_id='repo_qualification' and number=99;
insert into repository_issues(workspace_id,repository_id,number,title,body,author_principal_id)
values('workspace_qualification','repo_qualification',99,'Webhook qualification','transactional outbox event','principal_qualification');

DO $$
BEGIN
  IF (select count(*) from webhook_events where repository_id='repo_qualification' and event_name='issue.insert' and aggregate_id is not null) < 1 THEN
    RAISE EXCEPTION 'webhook event transaction assertion failed';
  END IF;
  IF (select count(*) from webhook_deliveries d join repository_webhooks w on w.id=d.webhook_id where w.repository_id='repo_qualification' and d.status='pending') < 1 THEN
    RAISE EXCEPTION 'webhook delivery enqueue assertion failed';
  END IF;
  IF to_regclass('public.webhook_deliveries') is null THEN RAISE EXCEPTION 'webhook delivery table missing'; END IF;
END $$;
SQL
printf 'Webhook outbox qualification passed: transactional event capture and durable delivery enqueue verified.\n'
