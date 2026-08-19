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
export STRIPE_SECRET_KEY="sk_test_qualification"
export STRIPE_WEBHOOK_SECRET="whsec_qualification"
export STRIPE_PRICE_DEVELOPER="price_qualification"

rendered="$(mktemp -t sessions-compose.XXXXXX.yml)"
trap 'rm -f "$rendered"' EXIT

docker compose -f docker-compose.production.yml config > "$rendered"

grep -q 'SESSIONS_ALLOW_INSECURE_LOCAL: "false"' "$rendered"
grep -q 'SESSIONS_CORS_ORIGIN: https://qualification.sessions.invalid' "$rendered"
grep -q '004-production-controls.sql' "$rendered"
grep -q '005-commercial-operations.sql' "$rendered"
grep -q '006-product-analytics.sql' "$rendered"
grep -q '007-billing-integrations.sql' "$rendered"
grep -q '008-repository-collaboration.sql' "$rendered"
grep -q '009-lifecycle-evidence-events.sql' "$rendered"
grep -q '010-hosted-auth.sql' "$rendered"
grep -q 'Dockerfile.auth' "$rendered"
grep -q 'Dockerfile.billing' "$rendered"
grep -q 'STRIPE_SECRET_KEY: sk_test_qualification' "$rendered"
grep -q 'STRIPE_WEBHOOK_SECRET: whsec_qualification' "$rendered"
grep -q 'STRIPE_PRICE_DEVELOPER: price_qualification' "$rendered"
grep -q 'read_only: true' "$rendered"
grep -q 'no-new-privileges:true' "$rendered"
grep -q 'internal: true' "$rendered"

for script in \
  scripts/backup-production.sh \
  scripts/restore-production.sh \
  scripts/deploy-production.sh \
  scripts/rollback-production.sh \
  scripts/check-production-slo.sh \
  scripts/provision-workspace.sh \
  scripts/seed-billing-qualification.sh; do
  test -s "$script"
  bash -n "$script"
done

grep -q 'backup-production.sh' scripts/deploy-production.sh
grep -q '010-hosted-auth.sql' scripts/deploy-production.sh
grep -q '011-repository-onboarding.sql' scripts/deploy-production.sh
grep -q '012-sessions-native-repository.sql' scripts/deploy-production.sh
grep -q 'build --pull api auth billing web runner' scripts/deploy-production.sh
grep -q 'up -d --no-deps api auth billing runner' scripts/deploy-production.sh
grep -q 'https://${SESSIONS_DOMAIN}/ready' scripts/deploy-production.sh
grep -q 'SESSIONS_RELEASE_ID' scripts/deploy-production.sh
grep -q 'ROLLBACK_REF' scripts/rollback-production.sh
grep -q 'SESSIONS_SLO_READY_MS' scripts/check-production-slo.sh
grep -q '/webhooks/stripe' infrastructure/docker/Caddyfile
grep -q 'reverse_proxy billing:4100' infrastructure/docker/Caddyfile
grep -q 'reverse_proxy auth:4200' infrastructure/docker/Caddyfile
grep -q 'header Authorization \*' infrastructure/docker/Caddyfile
grep -q 'rewrite \* /api/sessions' infrastructure/docker/Caddyfile

test -s infrastructure/postgres/012-sessions-native-repository.sql
grep -q 'sessions_repository_objects' infrastructure/postgres/012-sessions-native-repository.sql
grep -q 'sessions_repository_checkpoints' infrastructure/postgres/012-sessions-native-repository.sql
grep -q 'sessions_repository_refs' infrastructure/postgres/012-sessions-native-repository.sql

echo 'Production Compose, hosted auth, Stripe billing, Sessions-native repository transport, and operational deployment configuration validated.'
