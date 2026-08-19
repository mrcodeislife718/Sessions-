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

release_id="${RELEASE_ID:-$(git rev-parse --short=12 HEAD 2>/dev/null || date -u +%Y%m%d%H%M%S)}"
backup_dir="${SESSIONS_BACKUP_DIR:-./backups}"
mkdir -p "$backup_dir"

echo "[sessions] validating production configuration"
bash scripts/validate-production-config.sh

echo "[sessions] creating pre-deploy database backup"
SESSIONS_BACKUP_DIR="$backup_dir" bash scripts/backup-production.sh

echo "[sessions] building immutable release $release_id"
"${compose[@]}" build --pull api billing web runner

echo "[sessions] starting data services"
"${compose[@]}" up -d postgres redis minio

for migration in infrastructure/postgres/init.sql infrastructure/postgres/002-hosted-repositories.sql infrastructure/postgres/003-source-storage.sql infrastructure/postgres/004-production-controls.sql infrastructure/postgres/005-commercial-operations.sql infrastructure/postgres/006-product-analytics.sql infrastructure/postgres/007-billing-integrations.sql infrastructure/postgres/008-repository-collaboration.sql infrastructure/postgres/009-lifecycle-evidence-events.sql; do
  "${compose[@]}" exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 < "$migration"
done

echo "[sessions] rolling application services"
"${compose[@]}" up -d --no-deps api billing runner
"${compose[@]}" up -d --no-deps web
"${compose[@]}" up -d --no-deps proxy

for i in $(seq 1 60); do
  api_ok=0; billing_ok=0
  if curl --fail --silent --show-error "https://${SESSIONS_DOMAIN}/ready" >/dev/null; then api_ok=1; fi
  if curl --fail --silent --show-error "https://${SESSIONS_DOMAIN}/api/billing/subscription" -H "Authorization: Bearer ${SESSIONS_DEPLOY_HEALTH_TOKEN:-invalid}" >/dev/null 2>&1; then billing_ok=1; fi
  billing_code="$(curl -s -o /dev/null -w '%{http_code}' "https://${SESSIONS_DOMAIN}/api/billing/subscription" || true)"
  if [[ "$api_ok" == 1 && ( "$billing_ok" == 1 || "$billing_code" == 401 || "$billing_code" == 403 ) ]]; then
    printf '%s\n' "$release_id" > .sessions-last-good-release
    echo "[sessions] deployment healthy: $release_id"
    exit 0
  fi
  sleep 2
done

echo "[sessions] readiness failed; use scripts/rollback-production.sh" >&2
"${compose[@]}" ps >&2
exit 1
