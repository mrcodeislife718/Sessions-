#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:=postgresql://sessions:sessions@localhost:5432/sessions}"
export DATABASE_URL

source_db="$(psql "$DATABASE_URL" -Atc 'select current_database()')"
restore_db="sessions_restore_current_${GITHUB_RUN_ID:-local}_${GITHUB_RUN_ATTEMPT:-1}_$$"
restore_db="$(printf '%s' "$restore_db" | tr -cd 'A-Za-z0-9_' | cut -c1-60)"
backup_dir="$(mktemp -d -t sessions-current-recovery.XXXXXX)"
backup="$backup_dir/current.dump"
trap 'rm -rf "$backup_dir"' EXIT

server_major="$(psql "$DATABASE_URL" -Atc "show server_version_num" | awk '{print int($1/10000)}')"

run_pg17(){
  docker run --rm --network host "$@"
}

echo "[sessions-current-recovery] dumping current schema/data from $source_db (Postgres $server_major)"
if command -v pg_dump >/dev/null 2>&1 && [[ "$(pg_dump --version | awk '{print $NF}' | cut -d. -f1)" == "$server_major" ]]; then
  pg_dump "$DATABASE_URL" --format=custom --file="$backup"
else
  docker run --rm --network host -v "$backup_dir:/backup" postgres:"$server_major" \
    pg_dump "$DATABASE_URL" --format=custom --file=/backup/current.dump
fi

test -s "$backup" || { echo 'Current recovery dump is empty' >&2; exit 1; }

admin_url="$(printf '%s' "$DATABASE_URL" | sed -E "s#/[^/?]+([?].*)?$#/postgres\1#")"
echo "[sessions-current-recovery] creating isolated restore database $restore_db"
psql "$admin_url" -v ON_ERROR_STOP=1 -c "create database \"$restore_db\"" >/dev/null
restore_url="$(printf '%s' "$DATABASE_URL" | sed -E "s#/[^/?]+([?].*)?$#/$restore_db\1#")"

if command -v pg_restore >/dev/null 2>&1 && [[ "$(pg_restore --version | awk '{print $NF}' | cut -d. -f1)" == "$server_major" ]]; then
  pg_restore --dbname="$restore_url" --no-owner --no-privileges "$backup"
else
  docker run --rm --network host -v "$backup_dir:/backup" postgres:"$server_major" \
    pg_restore --dbname="$restore_url" --no-owner --no-privileges /backup/current.dump
fi

psql "$restore_url" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF to_regclass('public.repository_branch_policies') is null THEN RAISE EXCEPTION 'restored protected branch policy schema missing'; END IF;
  IF to_regclass('public.repository_webhooks') is null OR to_regclass('public.webhook_deliveries') is null THEN RAISE EXCEPTION 'restored webhook schema missing'; END IF;
  IF to_regclass('public.repository_environment_policies') is null OR to_regclass('public.deployment_approvals') is null THEN RAISE EXCEPTION 'restored deployment governance schema missing'; END IF;
  IF to_regclass('public.repository_lifecycle_events') is null THEN RAISE EXCEPTION 'restored lifecycle schema missing'; END IF;
  IF to_regclass('public.repository_artifacts') is null OR to_regclass('public.artifact_attestations') is null THEN RAISE EXCEPTION 'restored supply-chain schema missing'; END IF;
  IF to_regclass('public.principal_signing_keys') is null THEN RAISE EXCEPTION 'restored signing-key schema missing'; END IF;
  IF (select count(*) from hosted_repositories where id='repo_qualification')<>1 THEN RAISE EXCEPTION 'restored qualification repository missing'; END IF;
  IF (select count(*) from repository_branch_policies where repository_id='repo_qualification' and branch_name='main')<1 THEN RAISE EXCEPTION 'restored protected branch policy data missing'; END IF;
  IF (select count(*) from repository_environment_policies where repository_id='repo_qualification')<1 THEN RAISE EXCEPTION 'restored environment policy data missing'; END IF;
  IF (select count(*) from repository_artifacts where repository_id='repo_qualification' and sbom is not null)<1 THEN RAISE EXCEPTION 'restored artifact/SBOM data missing'; END IF;
  IF (select count(*) from artifact_attestations at join repository_artifacts a on a.id=at.artifact_id where a.repository_id='repo_qualification')<1 THEN RAISE EXCEPTION 'restored attestation data missing'; END IF;
  IF (select count(*) from principal_signing_keys where workspace_id='workspace_qualification')<1 THEN RAISE EXCEPTION 'restored signing-key data missing'; END IF;
END $$;
SQL

printf 'Current-schema recovery qualification passed: full dump/restore retained governance, integrations, lifecycle and supply-chain evidence in %s.\n' "$restore_db"
