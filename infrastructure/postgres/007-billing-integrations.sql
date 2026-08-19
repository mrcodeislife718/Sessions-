create table if not exists stripe_events (
  id text primary key,
  event_type text not null,
  livemode boolean not null default false,
  payload jsonb not null,
  processed_at timestamptz not null default now()
);

create table if not exists workspace_entitlements (
  workspace_id text primary key references workspaces(id) on delete cascade,
  plan_key text not null default 'free',
  status text not null default 'active',
  source text not null default 'internal',
  reason text,
  effective_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table billing_accounts add column if not exists external_provider text;
alter table billing_accounts add column if not exists payment_state text not null default 'ok';
alter table subscriptions add column if not exists cancel_at_period_end boolean not null default false;
alter table subscriptions add column if not exists canceled_at timestamptz;

create or replace function sessions_assert_workspace_entitled(target_workspace text)
returns void language plpgsql as $$
declare entitlement_status text;
begin
  select status into entitlement_status from workspace_entitlements where workspace_id = target_workspace;
  if entitlement_status in ('payment_failed','canceled','suspended') then
    raise exception 'workspace entitlement does not allow writes: %', entitlement_status using errcode = '42501';
  end if;
end;
$$;

create or replace function sessions_enforce_session_entitlement()
returns trigger language plpgsql as $$
begin
  perform sessions_assert_workspace_entitled(new.workspace_id);
  return new;
end;
$$;

drop trigger if exists trg_sessions_entitlement on sessions;
create trigger trg_sessions_entitlement before insert or update on sessions
for each row execute function sessions_enforce_session_entitlement();

create or replace function sessions_enforce_child_entitlement()
returns trigger language plpgsql as $$
declare target_workspace text;
begin
  select workspace_id into target_workspace from sessions where id = new.session_id;
  if target_workspace is not null then perform sessions_assert_workspace_entitled(target_workspace); end if;
  return new;
end;
$$;

foreach_table: begin end;

drop trigger if exists trg_session_events_entitlement on session_events;
create trigger trg_session_events_entitlement before insert or update on session_events for each row execute function sessions_enforce_child_entitlement();
drop trigger if exists trg_snapshots_entitlement on snapshots;
create trigger trg_snapshots_entitlement before insert or update on snapshots for each row execute function sessions_enforce_child_entitlement();
drop trigger if exists trg_verifications_entitlement on verifications;
create trigger trg_verifications_entitlement before insert or update on verifications for each row execute function sessions_enforce_child_entitlement();
