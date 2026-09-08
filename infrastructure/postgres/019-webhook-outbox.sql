begin;

create table if not exists repository_webhooks (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references workspaces(id) on delete cascade,
  repository_id text not null,
  endpoint_url text not null,
  events text[] not null default array['*']::text[],
  active boolean not null default true,
  secret_ciphertext text not null,
  secret_nonce text not null,
  secret_auth_tag text not null,
  created_by text references principals(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(repository_id, endpoint_url)
);
create index if not exists repository_webhooks_repo_idx on repository_webhooks(workspace_id, repository_id, active);

create table if not exists webhook_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references workspaces(id) on delete cascade,
  repository_id text not null,
  event_name text not null,
  aggregate_type text not null,
  aggregate_id text,
  payload jsonb not null,
  occurred_at timestamptz not null default now()
);
create index if not exists webhook_events_repo_time_idx on webhook_events(workspace_id, repository_id, occurred_at desc);

create table if not exists webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  webhook_id uuid not null references repository_webhooks(id) on delete cascade,
  event_id uuid not null references webhook_events(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','leased','succeeded','failed','dead')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_expires_at timestamptz,
  last_http_status integer,
  last_error text,
  response_excerpt text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(webhook_id,event_id)
);
create index if not exists webhook_deliveries_ready_idx on webhook_deliveries(status,next_attempt_at) where status in ('pending','failed','leased');

create or replace function sessions_enqueue_webhook_event() returns trigger as $$
declare
  event_id uuid := gen_random_uuid();
  event_name text;
  aggregate_type text;
  aggregate_id text;
  row_data jsonb;
begin
  row_data := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  aggregate_id := coalesce(row_data->>'id', row_data->>'number', row_data->>'tag_name');
  aggregate_type := case tg_table_name
    when 'repository_issues' then 'issue'
    when 'pull_requests' then 'pull_request'
    when 'action_runs' then 'action_run'
    when 'repository_releases' then 'release'
    when 'repository_deployments' then 'deployment'
    else tg_table_name end;
  event_name := aggregate_type || '.' || lower(tg_op);

  insert into webhook_events(id,workspace_id,repository_id,event_name,aggregate_type,aggregate_id,payload)
  values(event_id,row_data->>'workspace_id',row_data->>'repository_id',event_name,aggregate_type,aggregate_id,
    jsonb_build_object('event',event_name,'repositoryId',row_data->>'repository_id','resource',row_data));

  insert into webhook_deliveries(webhook_id,event_id)
  select w.id,event_id from repository_webhooks w
  where w.workspace_id=row_data->>'workspace_id' and w.repository_id=row_data->>'repository_id' and w.active=true
    and ('*'=any(w.events) or event_name=any(w.events));
  return case when tg_op='DELETE' then old else new end;
end;
$$ language plpgsql;

foreach table_name in array array['repository_issues','pull_requests','action_runs','repository_releases','repository_deployments'] loop
end loop;

-- PostgreSQL does not support dynamic CREATE TRIGGER in plain DDL, keep explicit triggers auditable.
drop trigger if exists trg_sessions_webhook_repository_issues on repository_issues;
create trigger trg_sessions_webhook_repository_issues after insert or update or delete on repository_issues for each row execute function sessions_enqueue_webhook_event();
drop trigger if exists trg_sessions_webhook_pull_requests on pull_requests;
create trigger trg_sessions_webhook_pull_requests after insert or update or delete on pull_requests for each row execute function sessions_enqueue_webhook_event();
drop trigger if exists trg_sessions_webhook_action_runs on action_runs;
create trigger trg_sessions_webhook_action_runs after insert or update or delete on action_runs for each row execute function sessions_enqueue_webhook_event();
drop trigger if exists trg_sessions_webhook_releases on repository_releases;
create trigger trg_sessions_webhook_releases after insert or update or delete on repository_releases for each row execute function sessions_enqueue_webhook_event();
drop trigger if exists trg_sessions_webhook_deployments on repository_deployments;
create trigger trg_sessions_webhook_deployments after insert or update or delete on repository_deployments for each row execute function sessions_enqueue_webhook_event();

commit;
