begin;

create table if not exists organization_retention_policies (
  organization_id text primary key references organizations(id) on delete cascade,
  audit_retention_days integer not null default 365 check (audit_retention_days between 30 and 3650),
  product_event_retention_days integer not null default 365 check (product_event_retention_days between 30 and 3650),
  webhook_retention_days integer not null default 90 check (webhook_retention_days between 7 and 3650),
  lifecycle_retention_days integer not null default 3650 check (lifecycle_retention_days between 365 and 3650),
  legal_hold boolean not null default false,
  legal_hold_reason text,
  created_by text references principals(id),
  updated_by text references principals(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not legal_hold or nullif(btrim(coalesce(legal_hold_reason,'')),'') is not null)
);

create index if not exists audit_events_workspace_action_time_idx
  on audit_events(workspace_id, action, occurred_at desc, id desc);

create index if not exists audit_events_workspace_outcome_time_idx
  on audit_events(workspace_id, outcome, occurred_at desc, id desc);

create or replace view organization_audit_events as
select w.organization_id,
       a.id,
       a.workspace_id,
       a.principal_id,
       a.request_id,
       a.action,
       a.resource_type,
       a.resource_id,
       a.outcome,
       a.metadata,
       a.occurred_at
from audit_events a
join workspaces w on w.id=a.workspace_id;

comment on table organization_retention_policies is
  'Enterprise retention and legal-hold policy. Enforcement workers must refuse destructive retention while legal_hold is true.';
comment on view organization_audit_events is
  'Organization-scoped audit projection used for enterprise export without weakening workspace tenancy.';

commit;
