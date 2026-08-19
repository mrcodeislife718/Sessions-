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
)

for migration in "${migrations[@]}"; do "${psql_cmd[@]}" -f "$migration"; done
for migration in "${migrations[@]}"; do "${psql_cmd[@]}" -f "$migration"; done

"${psql_cmd[@]}" <<'SQL'
insert into organizations (id, name) values ('org_qualification', 'Qualification Org') on conflict (id) do nothing;
insert into workspaces (id, organization_id, name) values ('workspace_qualification', 'org_qualification', 'Qualification Workspace') on conflict (id) do nothing;
insert into principals (id, kind, display_name) values ('principal_qualification', 'human', 'Qualification User') on conflict (id) do nothing;
insert into workspace_memberships (workspace_id, principal_id, role) values ('workspace_qualification', 'principal_qualification', 'owner') on conflict do nothing;
insert into hosted_repositories (id, workspace_id, name) values ('repo_qualification', 'workspace_qualification', 'qualification-repo') on conflict (id) do nothing;
insert into workspace_entitlements (workspace_id, plan_key, status, source) values ('workspace_qualification', 'developer', 'active', 'qualification') on conflict(workspace_id) do update set plan_key='developer',status='active',source='qualification',updated_at=now();
insert into sessions (id, workspace_id, project_id, repository_id, objective) values ('session_qualification', 'workspace_qualification', 'project_qualification', 'repo_qualification', 'prove persistence') on conflict (id) do nothing;
insert into session_events (id, session_id, type, occurred_at, actor, payload) values ('event_qualification', 'session_qualification', 'SessionStarted', now(), '{"id":"principal_qualification","kind":"human","displayName":"Qualification User"}', '{"objective":"prove persistence"}') on conflict (id) do nothing;
insert into snapshots (id, session_id, repository_id, digest, manifest, created_at) values ('snapshot_qualification', 'session_qualification', 'repo_qualification', 'sha256:qualification', '{"entries":[]}', now()) on conflict (id) do nothing;
insert into verifications (id, session_id, snapshot_id, kind, status, summary, requested_by, started_at, finished_at) values ('verification_qualification', 'session_qualification', 'snapshot_qualification', 'qualification', 'passed', 'database persistence verified', '{"id":"principal_qualification","kind":"human","displayName":"Qualification User"}', now(), now()) on conflict (id) do nothing;
insert into billing_accounts (id, workspace_id, plan_key, status, external_provider, payment_state) values ('billing_qualification', 'workspace_qualification', 'developer', 'active', 'stripe', 'ok') on conflict (id) do nothing;
insert into subscriptions (id, billing_account_id, plan_key, status, seats, external_subscription_ref) values ('subscription_qualification', 'billing_qualification', 'developer', 'active', 1, 'sub_qualification') on conflict (id) do nothing;
insert into stripe_events (id,event_type,livemode,payload) values ('evt_qualification','invoice.paid',false,'{"id":"evt_qualification","type":"invoice.paid"}') on conflict(id) do nothing;
insert into usage_events (id, billing_account_id, workspace_id, repository_id, session_id, dimension, quantity, unit, idempotency_key) values ('usage_qualification', 'billing_qualification', 'workspace_qualification', 'repo_qualification', 'session_qualification', 'runner_seconds', 1, 'second', 'qualification-usage') on conflict (id) do nothing;
insert into audit_events (id, workspace_id, principal_id, request_id, action, resource_type, resource_id, outcome) values ('audit_qualification', 'workspace_qualification', 'principal_qualification', 'request_qualification', 'session.create', 'session', 'session_qualification', 'allowed') on conflict (id) do nothing;
insert into product_events (id, workspace_id, principal_id, event_name, session_id, repository_id, properties) values ('product_qualification', 'workspace_qualification', 'principal_qualification', 'recovery_completed', 'session_qualification', 'repo_qualification', '{"source":"qualification"}') on conflict (id) do nothing;
insert into recovery_experiments (id, workspace_id, session_id, experiment_kind, baseline_kind, orientation_ms, missing_context_count, reproduction_success, continuation_ready, reconstruction_accuracy) values ('recovery_qualification', 'workspace_qualification', 'session_qualification', 'cross_environment', 'git_plus_chat', 1, 0, true, true, 1.0) on conflict (id) do nothing;
insert into workspace_limits (workspace_id, hosted_repository_limit, runner_seconds_monthly_limit, storage_bytes_limit) values ('workspace_qualification', 10, 10000, 1073741824) on conflict (workspace_id) do nothing;
insert into repository_issues (workspace_id, repository_id, number, title, body, author_principal_id) values ('workspace_qualification','repo_qualification',1,'Qualification issue','prove issue persistence','principal_qualification') on conflict(repository_id,number) do nothing;
insert into pull_requests (workspace_id, repository_id, number, title, base_branch, head_branch, head_commit_id, author_principal_id, verification_state) values ('workspace_qualification','repo_qualification',1,'Qualification PR','main','feature','cp_qualification','principal_qualification','passed') on conflict(repository_id,number) do nothing;
insert into action_runs (workspace_id, repository_id, commit_id, trigger, status, conclusion, actor_principal_id) values ('workspace_qualification','repo_qualification','cp_qualification','commit','completed','success','principal_qualification');
insert into repository_releases (workspace_id, repository_id, tag_name, name, commit_id, author_principal_id, published_at) values ('workspace_qualification','repo_qualification','v0.0.qualification','Qualification Release','cp_qualification','principal_qualification',now()) on conflict(repository_id,tag_name) do nothing;

DO $$
BEGIN
  IF (select count(*) from sessions where id='session_qualification') <> 1 THEN RAISE EXCEPTION 'session persistence assertion failed'; END IF;
  IF (select count(*) from session_events where session_id='session_qualification') <> 1 THEN RAISE EXCEPTION 'event persistence assertion failed'; END IF;
  IF (select count(*) from workspace_memberships where workspace_id='workspace_qualification') <> 1 THEN RAISE EXCEPTION 'tenancy assertion failed'; END IF;
  IF (select count(*) from usage_events where workspace_id='workspace_qualification') <> 1 THEN RAISE EXCEPTION 'usage assertion failed'; END IF;
  IF (select count(*) from product_events where workspace_id='workspace_qualification') <> 1 THEN RAISE EXCEPTION 'product telemetry assertion failed'; END IF;
  IF (select count(*) from recovery_experiments where continuation_ready is true) <> 1 THEN RAISE EXCEPTION 'recovery proof assertion failed'; END IF;
  IF (select count(*) from recovery_proof_summary) <> 1 THEN RAISE EXCEPTION 'recovery analytics view assertion failed'; END IF;
  IF (select count(*) from stripe_events where id='evt_qualification') <> 1 THEN RAISE EXCEPTION 'Stripe event ledger assertion failed'; END IF;
  IF (select status from workspace_entitlements where workspace_id='workspace_qualification') <> 'active' THEN RAISE EXCEPTION 'entitlement assertion failed'; END IF;
  IF (select count(*) from repository_issues where repository_id='repo_qualification') <> 1 THEN RAISE EXCEPTION 'issue persistence assertion failed'; END IF;
  IF (select count(*) from pull_requests where repository_id='repo_qualification') <> 1 THEN RAISE EXCEPTION 'pull request persistence assertion failed'; END IF;
  IF (select count(*) from action_runs where repository_id='repo_qualification') < 1 THEN RAISE EXCEPTION 'Actions persistence assertion failed'; END IF;
  IF (select count(*) from repository_releases where repository_id='repo_qualification') <> 1 THEN RAISE EXCEPTION 'release persistence assertion failed'; END IF;
END $$;
SQL

backup_dir="$(mktemp -d -t sessions-qualification.XXXXXX)"
backup="$backup_dir/sessions.dump"
trap 'rm -rf "$backup_dir"' EXIT
server_major="$(psql "$DATABASE_URL" -Atc "show server_version_num" | awk '{print int($1/10000)}')"
client_major="$(pg_dump --version | awk '{print $NF}' | cut -d. -f1)"
host_uid="$(id -u)"
host_gid="$(id -g)"

pg_dump_matched() {
  if [[ "$server_major" == "$client_major" ]]; then pg_dump "$DATABASE_URL" --format=custom --file="$backup";
  elif command -v docker >/dev/null 2>&1; then
    local dir file; dir="$(dirname "$backup")"; file="$(basename "$backup")"
    docker run --rm --user "$host_uid:$host_gid" --network host -e PGPASSWORD="${PGPASSWORD:-}" -v "$dir:/backup" "postgres:${server_major}" pg_dump "$DATABASE_URL" --format=custom --file="/backup/$file"
  else echo "pg_dump major version $client_major does not match server $server_major and Docker is unavailable" >&2; exit 1; fi
}
pg_restore_matched() {
  local restore_url="$1"
  if [[ "$server_major" == "$client_major" ]]; then pg_restore --no-owner --no-privileges --dbname="$restore_url" "$backup";
  elif command -v docker >/dev/null 2>&1; then
    local dir file; dir="$(dirname "$backup")"; file="$(basename "$backup")"
    docker run --rm --user "$host_uid:$host_gid" --network host -e PGPASSWORD="${PGPASSWORD:-}" -v "$dir:/backup:ro" "postgres:${server_major}" pg_restore --no-owner --no-privileges --dbname="$restore_url" "/backup/$file"
  else echo "pg_restore major version $client_major does not match server $server_major and Docker is unavailable" >&2; exit 1; fi
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
END $$;
SQL
printf 'PostgreSQL qualification passed: migrations, persistence, collaboration, backup, and independent restore verified.\n'
