#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${WORKSPACE_NAME:?WORKSPACE_NAME is required}"
: "${PRINCIPAL_NAME:?PRINCIPAL_NAME is required}"
: "${PLAN_KEY:=developer}"
: "${PRINCIPAL_KIND:=human}"

case "$PLAN_KEY" in free|developer|team|business|enterprise) ;; *) echo "Invalid PLAN_KEY" >&2; exit 2;; esac
case "$PRINCIPAL_KIND" in human|service|ai_worker) ;; *) echo "Invalid PRINCIPAL_KIND" >&2; exit 2;; esac

uuid() { cat /proc/sys/kernel/random/uuid; }
org_id="org_$(uuid)"
workspace_id="workspace_$(uuid)"
principal_id="principal_$(uuid)"
credential_id="credential_$(uuid)"
billing_id="billing_$(uuid)"
subscription_id="subscription_$(uuid)"
raw_token="sess_$(openssl rand -hex 32)"
token_hash="$(printf '%s' "$raw_token" | sha256sum | awk '{print $1}')"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v org_id="$org_id" -v workspace_id="$workspace_id" -v principal_id="$principal_id" \
  -v credential_id="$credential_id" -v billing_id="$billing_id" -v subscription_id="$subscription_id" \
  -v workspace_name="$WORKSPACE_NAME" -v principal_name="$PRINCIPAL_NAME" -v principal_kind="$PRINCIPAL_KIND" \
  -v plan_key="$PLAN_KEY" -v token_hash="$token_hash" <<'SQL'
begin;
insert into organizations (id, name) values (:'org_id', :'workspace_name');
insert into workspaces (id, organization_id, name) values (:'workspace_id', :'org_id', :'workspace_name');
insert into principals (id, kind, display_name) values (:'principal_id', :'principal_kind', :'principal_name');
insert into workspace_memberships (workspace_id, principal_id, role) values (:'workspace_id', :'principal_id', 'owner');
insert into api_credentials (id, workspace_id, principal_id, token_hash, scopes)
values (:'credential_id', :'workspace_id', :'principal_id', :'token_hash', array['sessions:read','sessions:write','sessions:verify','sessions:rollback','metrics:read']);
insert into billing_accounts (id, workspace_id, plan_key, status) values (:'billing_id', :'workspace_id', :'plan_key', 'active');
insert into subscriptions (id, billing_account_id, plan_key, status, seats) values (:'subscription_id', :'billing_id', :'plan_key', 'active', 1);
insert into product_events (id, workspace_id, principal_id, event_name, properties)
values ('product_' || gen_random_uuid()::text, :'workspace_id', :'principal_id', 'workspace_provisioned', jsonb_build_object('plan', :'plan_key'));
commit;
SQL

cat <<EOF
Workspace provisioned.
organization_id=$org_id
workspace_id=$workspace_id
principal_id=$principal_id
plan=$PLAN_KEY

SESSIONS_API_TOKEN=$raw_token

The token is shown once. Store it securely; only its SHA-256 digest is persisted.
EOF
