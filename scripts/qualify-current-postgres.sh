#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:=postgresql://sessions:sessions@localhost:5432/sessions}"
export DATABASE_URL
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Preserve the existing deep persistence/recovery qualification, then advance the
# qualified database through the exact same canonical migration set used by deploy.
bash "$root/scripts/qualify-postgres.sh"

mapfile -t migrations < <("$root/scripts/list-migrations.sh")
for migration in "${migrations[@]}"; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration" >/dev/null
done
# Every migration is required to remain replay-safe.
for migration in "${migrations[@]}"; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration" >/dev/null
done

latest="$(basename "${migrations[${#migrations[@]}-1]}")"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF to_regclass('public.repository_branch_policies') is null THEN RAISE EXCEPTION 'protected branch schema missing'; END IF;
  IF to_regclass('public.repository_webhooks') is null OR to_regclass('public.webhook_deliveries') is null THEN RAISE EXCEPTION 'webhook schema missing'; END IF;
  IF to_regclass('public.repository_environment_policies') is null OR to_regclass('public.deployment_approvals') is null THEN RAISE EXCEPTION 'release/deployment governance schema missing'; END IF;
  IF to_regclass('public.repository_lifecycle_events') is null THEN RAISE EXCEPTION 'repository lifecycle schema missing'; END IF;
  IF to_regclass('public.repository_artifacts') is null OR to_regclass('public.artifact_attestations') is null THEN RAISE EXCEPTION 'artifact attestation schema missing'; END IF;
  IF to_regclass('public.principal_signing_keys') is null THEN RAISE EXCEPTION 'signing key schema missing'; END IF;
  IF to_regclass('public.organization_security_policies') is null THEN RAISE EXCEPTION 'organization security policy schema missing'; END IF;
  IF to_regprocedure('public.sessions_enforce_branch_policy_floor()') is null THEN RAISE EXCEPTION 'organization branch policy floor function missing'; END IF;
  IF to_regprocedure('public.sessions_enforce_environment_policy_floor()') is null THEN RAISE EXCEPTION 'organization environment policy floor function missing'; END IF;
END $$;
SQL
printf 'Current PostgreSQL qualification passed through %s (%s migrations, replay-safe).\n' "$latest" "${#migrations[@]}"
