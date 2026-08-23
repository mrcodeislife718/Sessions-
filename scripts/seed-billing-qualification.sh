#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:=postgresql://sessions:sessions@localhost:5432/sessions}"
: "${BILLING_TEST_TOKEN:=sessions-billing-test-token}"
export DATABASE_URL BILLING_TEST_TOKEN

for migration in \
  infrastructure/postgres/init.sql \
  infrastructure/postgres/002-hosted-repositories.sql \
  infrastructure/postgres/003-source-storage.sql \
  infrastructure/postgres/004-production-controls.sql \
  infrastructure/postgres/005-commercial-operations.sql \
  infrastructure/postgres/006-product-analytics.sql \
  infrastructure/postgres/007-billing-integrations.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"
done

token_hash="$(printf '%s' "$BILLING_TEST_TOKEN" | sha256sum | awk '{print $1}')"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
insert into organizations(id,name) values('org_billing_qualification','Billing Qualification') on conflict(id) do nothing;
insert into workspaces(id,organization_id,name) values('workspace_billing_qualification','org_billing_qualification','Billing Qualification') on conflict(id) do nothing;
insert into principals(id,kind,display_name,email) values('principal_billing_qualification','human','Billing Qualification','billing@example.invalid') on conflict(id) do nothing;
insert into workspace_memberships(workspace_id,principal_id,role) values('workspace_billing_qualification','principal_billing_qualification','owner') on conflict do nothing;
insert into api_credentials(id,workspace_id,principal_id,token_hash,scopes) values('credential_billing_qualification','workspace_billing_qualification','principal_billing_qualification','$token_hash',array['billing:read','billing:write','account:export','sessions:read','sessions:write','sessions:verify','sessions:rollback']) on conflict(id) do update set token_hash=excluded.token_hash,scopes=excluded.scopes,status='active';
insert into billing_accounts(id,workspace_id,plan_key,status,billing_email) values('billing_billing_qualification','workspace_billing_qualification','free','active','billing@example.invalid') on conflict(id) do nothing;
insert into workspace_entitlements(workspace_id,plan_key,status,source) values('workspace_billing_qualification','free','active','internal') on conflict(workspace_id) do update set status='active',plan_key='free',source='internal',updated_at=now();
insert into hosted_repositories(id,workspace_id,name) values('repo_billing_qualification','workspace_billing_qualification','billing-qualification') on conflict(id) do nothing;
SQL

echo "Billing qualification tenant seeded."
