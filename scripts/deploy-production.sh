#!/usr/bin/env bash
set -euo pipefail

compose=(docker compose -f docker-compose.production.yml)
: "${SESSIONS_DOMAIN:?SESSIONS_DOMAIN is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${REDIS_PASSWORD:?REDIS_PASSWORD is required}"
: "${MINIO_ROOT_USER:?MINIO_ROOT_USER is required}"
: "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD is required}"
: "${STRIPE_SECRET_KEY:?STRIPE_SECRET_KEY is required}"
: "${STRIPE_WEBHOOK_SECRET:?STRIPE_WEBHOOK_SECRET is required}"
: "${STRIPE_PRICE_DEVELOPER:?STRIPE_PRICE_DEVELOPER is required}"

release_id="${SESSIONS_RELEASE_ID:-sessions-release-$(date -u +%Y%m%dT%H%M%SZ)}"
backup_dir="${SESSIONS_BACKUP_DIR:-./backups}"
mkdir -p "$backup_dir"

echo "[sessions] validating production configuration"
bash scripts/validate-production-config.sh

echo "[sessions] creating pre-deploy database backup"
SESSIONS_BACKUP_DIR="$backup_dir" bash scripts/backup-production.sh

echo "[sessions] building Sessions release $release_id"
"${compose[@]}" build --pull api auth billing repositories workflows web runner executor

echo "[sessions] starting data services"
"${compose[@]}" up -d postgres redis minio

migrations=(
  infrastructure/postgres/init.sql
  infrastructure/postgres/002-hosted-repositories.sql
  infrastructure/postgres/003-source-storage.sql
  infrastructure/postgres/004-production-controls.sql
  infrastructure/postgres/005-commercial-operations.sql
  infrastructure/postgres/006-product-analytics.sql
  infrastructure/postgres/007-billing-integrations.sql
  infrastructure/postgres/008-repository-collaboration.sql
  infrastructure/postgres/009-lifecycle-evidence-events.sql
  infrastructure/postgres/010-hosted-auth.sql
  infrastructure/postgres/011-repository-onboarding.sql
  infrastructure/postgres/012-sessions-native-repository.sql
  infrastructure/postgres/013-team-invitations.sql
  infrastructure/postgres/014-action-workflows.sql
)
for migration in "${migrations[@]}"; do
  echo "[sessions] applying $migration"
  "${compose[@]}" exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 < "$migration"
done

echo "[sessions] rolling application services"
"${compose[@]}" up -d --no-deps api auth billing repositories workflows runner executor
"${compose[@]}" up -d --no-deps web
"${compose[@]}" up -d --no-deps proxy

for i in $(seq 1 60); do
  api_ok=0; billing_ok=0; auth_ok=0; legacy_ok=0; workflows_ok=0; executor_ok=0
  if curl --fail --silent --show-error "https://${SESSIONS_DOMAIN}/ready" >/dev/null; then api_ok=1; fi
  billing_code="$(curl -s -o /dev/null -w '%{http_code}' "https://${SESSIONS_DOMAIN}/api/billing/subscription" || true)"
  auth_code="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' --data '{}' "https://${SESSIONS_DOMAIN}/api/auth/login" || true)"
  legacy_code="$("${compose[@]}" exec -T repositories sh -c 'wget -q -O - http://127.0.0.1:4300/health >/dev/null && printf 200' 2>/dev/null || true)"
  workflows_code="$("${compose[@]}" exec -T workflows sh -c 'wget -q -O - http://127.0.0.1:4400/health >/dev/null && printf 200' 2>/dev/null || true)"
  if "${compose[@]}" ps --status running executor | grep -q executor; then executor_ok=1; fi
  if [[ "$billing_code" == 401 || "$billing_code" == 403 || "$billing_code" == 200 ]]; then billing_ok=1; fi
  if [[ "$auth_code" == 400 || "$auth_code" == 401 || "$auth_code" == 422 ]]; then auth_ok=1; fi
  if [[ "$legacy_code" == 200 ]]; then legacy_ok=1; fi
  if [[ "$workflows_code" == 200 ]]; then workflows_ok=1; fi
  if [[ "$api_ok" == 1 && "$billing_ok" == 1 && "$auth_ok" == 1 && "$legacy_ok" == 1 && "$workflows_ok" == 1 && "$executor_ok" == 1 ]]; then
    printf '%s\n' "$release_id" > .sessions-last-good-release
    echo "[sessions] deployment healthy: $release_id"
    exit 0
  fi
  sleep 2
done

echo "[sessions] readiness failed; use scripts/rollback-production.sh" >&2
"${compose[@]}" ps >&2
exit 1
