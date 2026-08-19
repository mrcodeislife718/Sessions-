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
for migration in 004-production-controls.sql 005-commercial-operations.sql 006-product-analytics.sql 007-billing-integrations.sql 008-repository-collaboration.sql 009-lifecycle-evidence-events.sql 010-hosted-auth.sql 011-repository-onboarding.sql 012-sessions-native-repository.sql 013-team-invitations.sql 014-action-workflows.sql; do grep -q "$migration" "$rendered"; done
for dockerfile in Dockerfile.auth Dockerfile.billing Dockerfile.repositories Dockerfile.workflows Dockerfile.executor; do grep -q "$dockerfile" "$rendered"; done
grep -q 'STRIPE_SECRET_KEY: sk_test_qualification' "$rendered"
grep -q 'STRIPE_WEBHOOK_SECRET: whsec_qualification' "$rendered"
grep -q 'STRIPE_PRICE_DEVELOPER: price_qualification' "$rendered"
grep -q 'read_only: true' "$rendered"
grep -q 'no-new-privileges:true' "$rendered"
grep -q 'internal: true' "$rendered"
grep -q 'DOCKER_HOST: unix:///var/run/docker.sock' "$rendered"
grep -q '/var/run/docker.sock:/var/run/docker.sock' "$rendered"
grep -q 'SESSIONS_JOB_VOLUME: sessions_jobs' "$rendered"
grep -q 'SESSIONS_ACTION_MEMORY: 1g' "$rendered"
grep -q 'SESSIONS_ACTION_CPUS: 1.0' "$rendered"

for script in scripts/backup-production.sh scripts/restore-production.sh scripts/deploy-production.sh scripts/rollback-production.sh scripts/check-production-slo.sh scripts/provision-workspace.sh scripts/seed-billing-qualification.sh; do test -s "$script"; bash -n "$script"; done

grep -q 'backup-production.sh' scripts/deploy-production.sh
grep -q '014-action-workflows.sql' scripts/deploy-production.sh
grep -q 'build --pull api auth billing repositories workflows web runner executor' scripts/deploy-production.sh
grep -q 'up -d --no-deps api auth billing repositories workflows runner executor' scripts/deploy-production.sh
grep -q 'https://${SESSIONS_DOMAIN}/ready' scripts/deploy-production.sh
grep -q 'SESSIONS_RELEASE_ID' scripts/deploy-production.sh
grep -q 'ROLLBACK_REF' scripts/rollback-production.sh
grep -q 'SESSIONS_SLO_READY_MS' scripts/check-production-slo.sh
grep -q '/webhooks/stripe' infrastructure/docker/Caddyfile
grep -q 'reverse_proxy billing:4100' infrastructure/docker/Caddyfile
grep -q 'reverse_proxy auth:4200' infrastructure/docker/Caddyfile
grep -q 'legacyGitImport' infrastructure/docker/Caddyfile
grep -q 'reverse_proxy repositories:4300' infrastructure/docker/Caddyfile
grep -q 'workflowControl' infrastructure/docker/Caddyfile
grep -q 'reverse_proxy workflows:4400' infrastructure/docker/Caddyfile
grep -q 'reverse_proxy api:4000' infrastructure/docker/Caddyfile
grep -q 'header Authorization \*' infrastructure/docker/Caddyfile
grep -q 'rewrite \* /api/sessions' infrastructure/docker/Caddyfile

test -s infrastructure/postgres/012-sessions-native-repository.sql
test -s infrastructure/postgres/013-team-invitations.sql
test -s infrastructure/postgres/014-action-workflows.sql
grep -q 'sessions_repository_objects' infrastructure/postgres/012-sessions-native-repository.sql
grep -q 'workspace_invitations' infrastructure/postgres/013-team-invitations.sql
grep -q 'repository_action_workflows' infrastructure/postgres/014-action-workflows.sql
grep -q 'customer_workflow' infrastructure/postgres/014-action-workflows.sql
grep -q -- '--network","none"' apps/runner/src/workflow-executor.ts
grep -q -- '--read-only' apps/runner/src/workflow-executor.ts
grep -q -- '--cap-drop' apps/runner/src/workflow-executor.ts

echo 'Production Compose, commercial auth/billing, Sessions-native source control, customer workflows, isolated execution, and operational deployment configuration validated.'
