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
export SESSIONS_WEBHOOK_MASTER_KEY="qualification-webhook-master-key-at-least-32-bytes"
export STRIPE_SECRET_KEY="sk_test_qualification"
export STRIPE_WEBHOOK_SECRET="whsec_qualification"
export STRIPE_PRICE_DEVELOPER="price_qualification"

rendered="$(mktemp -t sessions-compose.XXXXXX.yml)"
trap 'rm -f "$rendered"' EXIT
docker compose -f docker-compose.production.yml config > "$rendered"

require_grep(){ local pattern="$1" file="$2" label="$3"; if ! grep -Fq -- "$pattern" "$file"; then echo "Production qualification missing: $label" >&2; echo "  expected literal: $pattern" >&2; echo "  file: $file" >&2; return 1; fi; }
require_regex(){ local pattern="$1" file="$2" label="$3"; if ! grep -Eq -- "$pattern" "$file"; then echo "Production qualification missing: $label" >&2; echo "  expected pattern: $pattern" >&2; echo "  file: $file" >&2; return 1; fi; }

require_grep 'SESSIONS_ALLOW_INSECURE_LOCAL: "false"' "$rendered" 'insecure-local override disabled'
require_grep 'SESSIONS_CORS_ORIGIN: https://qualification.sessions.invalid' "$rendered" 'production CORS origin'
require_grep 'SESSIONS_WEBHOOK_MASTER_KEY: qualification-webhook-master-key-at-least-32-bytes' "$rendered" 'webhook encryption key propagation'
require_grep 'SESSIONS_ALLOW_INSECURE_WEBHOOKS: "false"' "$rendered" 'insecure outbound webhooks disabled'
require_regex 'source: .*/infrastructure/postgres' "$rendered" 'canonical migration directory mount'
require_grep 'target: /sessions-migrations' "$rendered" 'canonical migration directory target'
require_regex 'source: .*/infrastructure/docker/init-postgres\.sh' "$rendered" 'fresh database migration runner mount'
require_grep 'target: /docker-entrypoint-initdb.d/001-sessions-migrations.sh' "$rendered" 'fresh database migration runner target'

test -s scripts/list-migrations.sh
test -s infrastructure/docker/init-postgres.sh
bash -n scripts/list-migrations.sh
bash -n infrastructure/docker/init-postgres.sh
mapfile -t migrations < <(bash scripts/list-migrations.sh)
[[ "${#migrations[@]}" -ge 2 ]] || { echo 'Canonical migration list is unexpectedly empty' >&2; exit 1; }
[[ "${migrations[0]}" == */infrastructure/postgres/init.sql ]] || { echo 'init.sql is not first migration' >&2; exit 1; }
latest="$(basename "${migrations[${#migrations[@]}-1]}")"
[[ "$latest" == '022-repository-lifecycle.sql' ]] || { echo "Unexpected latest migration: $latest" >&2; exit 1; }
require_grep 'mapfile -t migrations < <(bash scripts/list-migrations.sh)' scripts/deploy-production.sh 'deploy uses canonical migration order'

for dockerfile in Dockerfile.auth Dockerfile.billing Dockerfile.repositories Dockerfile.workflows Dockerfile.executor Dockerfile.api; do
  require_grep "$dockerfile" "$rendered" "production image $dockerfile"
done
require_grep 'STRIPE_SECRET_KEY: sk_test_qualification' "$rendered" 'Stripe secret propagation'
require_grep 'STRIPE_WEBHOOK_SECRET: whsec_qualification' "$rendered" 'Stripe webhook secret propagation'
require_grep 'STRIPE_PRICE_DEVELOPER: price_qualification' "$rendered" 'Stripe developer price propagation'
require_grep 'read_only: true' "$rendered" 'read-only container filesystem'
require_grep 'no-new-privileges:true' "$rendered" 'no-new-privileges container security option'
require_grep 'internal: true' "$rendered" 'internal production network'
require_grep 'DOCKER_HOST: unix:///var/run/docker.sock' "$rendered" 'executor Docker host'
require_regex 'source: /var/run/docker\.sock' "$rendered" 'executor Docker socket source mount'
require_regex 'target: /var/run/docker\.sock' "$rendered" 'executor Docker socket target mount'
require_grep 'SESSIONS_JOB_VOLUME: sessions_jobs' "$rendered" 'executor job volume'
require_grep 'SESSIONS_ACTION_MEMORY: 1g' "$rendered" 'executor memory limit'
require_regex 'SESSIONS_ACTION_CPUS: ("?1\.0"?|1)' "$rendered" 'executor CPU limit'

for script in scripts/backup-production.sh scripts/restore-production.sh scripts/deploy-production.sh scripts/rollback-production.sh scripts/check-production-slo.sh scripts/provision-workspace.sh scripts/seed-billing-qualification.sh scripts/qualify-webhook-outbox.sh scripts/qualify-release-governance.sh scripts/qualify-native-webhooks.sh scripts/qualify-repository-lifecycle.sh; do
  test -s "$script" || { echo "Production qualification missing non-empty script: $script" >&2; exit 1; }
  bash -n "$script"
done
require_grep 'backup-production.sh' scripts/deploy-production.sh 'pre-deploy backup'
require_grep 'build --pull api auth billing repositories workflows webhooks webhook-worker web runner executor' scripts/deploy-production.sh 'production image build set'
require_grep 'up -d --no-deps api auth billing repositories workflows webhooks webhook-worker runner executor' scripts/deploy-production.sh 'production service restart set'
require_grep 'SESSIONS_WEBHOOK_MASTER_KEY is required' scripts/deploy-production.sh 'webhook master key deploy precondition'
require_grep 'https://${SESSIONS_DOMAIN}/ready' scripts/deploy-production.sh 'post-deploy readiness check'
require_grep 'webhooks_code=' scripts/deploy-production.sh 'webhook control service readiness check'
require_grep 'webhook_worker_ok=1' scripts/deploy-production.sh 'webhook worker process readiness check'
require_grep 'SESSIONS_RELEASE_ID' scripts/deploy-production.sh 'release identity tracking'
require_grep 'ROLLBACK_REF' scripts/rollback-production.sh 'rollback ref support'
require_grep 'SESSIONS_SLO_READY_MS' scripts/check-production-slo.sh 'SLO readiness threshold'

require_grep '/webhooks/stripe' infrastructure/docker/Caddyfile 'Stripe webhook route'
require_grep 'repositoryControl' infrastructure/docker/Caddyfile 'repository governance route'
require_grep 'lifecycle' infrastructure/docker/Caddyfile 'repository lifecycle route'
require_grep 'branch-policies' infrastructure/docker/Caddyfile 'branch policy route'
require_grep 'environment-policies' infrastructure/docker/Caddyfile 'environment policy route'
require_grep 'deployments/[^/]+/(approvals|status)' infrastructure/docker/Caddyfile 'deployment approval/status route'
require_grep 'reverse_proxy repositories:4300' infrastructure/docker/Caddyfile 'repository proxy'
require_grep 'webhookControl' infrastructure/docker/Caddyfile 'webhook control route'
require_grep 'reverse_proxy webhooks:4500' infrastructure/docker/Caddyfile 'webhook proxy'
require_grep 'workflowControl' infrastructure/docker/Caddyfile 'workflow control route'
require_grep 'reverse_proxy workflows:4400' infrastructure/docker/Caddyfile 'workflow proxy'
require_grep 'reverse_proxy api:4000' infrastructure/docker/Caddyfile 'API proxy'

for schema in infrastructure/postgres/012-sessions-native-repository.sql infrastructure/postgres/014-action-workflows.sql infrastructure/postgres/018-protected-branch-governance.sql infrastructure/postgres/019-webhook-outbox.sql infrastructure/postgres/020-release-deployment-governance.sql infrastructure/postgres/021-native-repository-webhook-events.sql infrastructure/postgres/022-repository-lifecycle.sql; do test -s "$schema" || { echo "Production qualification missing schema: $schema" >&2; exit 1; }; done
require_grep 'repository_branch_policies' infrastructure/postgres/018-protected-branch-governance.sql 'protected branch policy schema'
require_grep 'webhook_deliveries' infrastructure/postgres/019-webhook-outbox.sql 'durable webhook delivery schema'
require_grep 'repository_environment_policies' infrastructure/postgres/020-release-deployment-governance.sql 'protected environment schema'
require_grep 'checkpoint.insert' infrastructure/postgres/021-native-repository-webhook-events.sql 'native checkpoint integration event'
require_grep 'lifecycle_status' infrastructure/postgres/022-repository-lifecycle.sql 'repository lifecycle schema'
require_grep 'sessions.lifecycle_purge' infrastructure/postgres/022-repository-lifecycle.sql 'controlled purge bypass'

require_grep '"--network"' apps/runner/src/workflow-executor.ts 'explicit Docker network policy flag'
require_grep 'defaultNetwork: "none"' apps/runner/src/workflow-executor.ts 'deny-by-default executor network'
require_grep '"--read-only"' apps/runner/src/workflow-executor.ts 'read-only executor root filesystem'
require_grep '"--cap-drop"' apps/runner/src/workflow-executor.ts 'capability drop in executor'
require_grep '"ALL"' apps/runner/src/workflow-executor.ts 'drop all Linux capabilities'
require_grep '"no-new-privileges:true"' apps/runner/src/workflow-executor.ts 'no-new-privileges executor policy'
require_grep 'secretsRedacted: true' apps/runner/src/workflow-executor.ts 'secret redaction evidence'

echo 'Production topology validated: canonical schema migration, commerce, auth, native source control, lifecycle/branch/environment governance, durable integrations, isolated execution, release/deploy integrity and recovery are wired consistently.'
