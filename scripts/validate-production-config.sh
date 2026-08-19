#!/usr/bin/env bash
set -euo pipefail

export SESSIONS_DOMAIN="qualification.sessions.invalid"
export POSTGRES_USER="sessions"
export POSTGRES_PASSWORD="qualification-postgres-password"
export POSTGRES_DB="sessions"
export REDIS_PASSWORD="qualification-redis-password"
export MINIO_ROOT_USER="sessions-storage"
export MINIO_ROOT_PASSWORD="qualification-minio-password"
export S3_BUCKET="sessions"

rendered="$(mktemp -t sessions-compose.XXXXXX.yml)"
trap 'rm -f "$rendered"' EXIT

docker compose -f docker-compose.production.yml config > "$rendered"

grep -q 'SESSIONS_ALLOW_INSECURE_LOCAL: "false"' "$rendered"
grep -q 'SESSIONS_CORS_ORIGIN: https://qualification.sessions.invalid' "$rendered"
grep -q '004-production-controls.sql' "$rendered"
grep -q '005-commercial-operations.sql' "$rendered"
grep -q '006-product-analytics.sql' "$rendered"
grep -q 'read_only: true' "$rendered"
grep -q 'no-new-privileges:true' "$rendered"
grep -q 'internal: true' "$rendered"

for script in \
  scripts/backup-production.sh \
  scripts/restore-production.sh \
  scripts/deploy-production.sh \
  scripts/rollback-production.sh \
  scripts/check-production-slo.sh \
  scripts/provision-workspace.sh; do
  test -s "$script"
  bash -n "$script"
done

grep -q 'backup-production.sh' scripts/deploy-production.sh
grep -q 'validate-production-config.sh' scripts/deploy-production.sh
grep -q 'https://${SESSIONS_DOMAIN}/ready' scripts/deploy-production.sh
grep -q 'ROLLBACK_REF' scripts/rollback-production.sh
grep -q 'SESSIONS_SLO_READY_MS' scripts/check-production-slo.sh

echo 'Production Compose and operational deployment configuration validated.'
