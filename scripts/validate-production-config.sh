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

require_grep() {
  local pattern="$1"
  local file="$2"
  local label="$3"
  if ! grep -Fq -- "$pattern" "$file"; then
    echo "Production qualification missing: $label" >&2
    echo "  expected literal: $pattern" >&2
    echo "  file: $file" >&2
    return 1
  fi
}

require_regex() {
  local pattern="$1"
  local file="$2"
  local label="$3"
  if ! grep -Eq -- "$pattern" "$file"; then
    echo "Production qualification missing: $label" >&2
    echo "  expected pattern: $pattern" >&2
    echo "  file: $file" >&2
    return 1
  fi
}

require_grep 'SESSIONS_ALLOW_INSECURE_LOCAL: "false"' "$rendered" 'insecure-local override disabled'
require_grep 'SESSIONS_CORS_ORIGIN: https://qualification.sessions.invalid' "$rendered" 'production CORS origin'

for migration in \
  004-production-controls.sql \
  005-commercial-operations.sql \
  006-product-analytics.sql \
  007-billing-integrations.sql \
  008-repository-collaboration.sql \
  009-lifecycle-evidence-events.sql \
  010-hosted-auth.sql \
  011-repository-onboarding.sql \
  012-sessions-native-repository.sql \
  013-team-invitations.sql \
  014-action-workflows.sql; do
  require_grep "$migration" "$rendered" "migration $migration wired into production Compose"
done

for dockerfile in \
  Dockerfile.auth \
  Dockerfile.billing \
  Dockerfile.repositories \
  Dockerfile.workflows \
  Dockerfile.executor; do
  require_grep "$dockerfile" "$rendered" "production image $dockerfile"
done

require_grep 'STRIPE_SECRET_KEY: sk_test_qualification' "$rendered" 'Stripe secret propagation'
require_grep 'STRIPE_WEBHOOK_SECRET: whsec_qualification' "$rendered" 'Stripe webhook secret propagation'
require_grep 'STRIPE_PRICE_DEVELOPER: price_qualification' "$rendered" 'Stripe developer price propagation'
require_grep 'read_only: true' "$rendered" 'read-only container filesystem'
require_grep 'no-new-privileges:true' "$rendered" 'no-new-privileges container security option'
require_grep 'internal: true' "$rendered" 'internal production network'
require_grep 'DOCKER_HOST: unix:///var/run/docker.sock' "$rendered" 'executor Docker host'
require_grep '/var/run/docker.sock:/var/run/docker.sock' "$rendered" 'executor Docker socket mount'
require_grep 'SESSIONS_JOB_VOLUME: sessions_jobs' "$rendered" 'executor job volume'
require_grep 'SESSIONS_ACTION_MEMORY: 1g' "$rendered" 'executor memory limit'
require_regex 'SESSIONS_ACTION_CPUS: ("?1\.0"?|1)' "$rendered" 'executor CPU limit'

for script in \
  scripts/backup-production.sh \
  scripts/restore-production.sh \
  scripts/deploy-production.sh \
  scripts/rollback-production.sh \
  scripts/check-production-slo.sh \
  scripts/provision-workspace.sh \
  scripts/seed-billing-qualification.sh; do
  test -s "$script" || { echo "Production qualification missing non-empty script: $script" >&2; exit 1; }
  bash -n "$script"
done

require_grep 'backup-production.sh' scripts/deploy-production.sh 'pre-deploy backup'
require_grep '014-action-workflows.sql' scripts/deploy-production.sh 'latest workflow migration during deploy'
require_grep 'build --pull api auth billing repositories workflows web runner executor' scripts/deploy-production.sh 'production image build set'
require_grep 'up -d --no-deps api auth billing repositories workflows runner executor' scripts/deploy-production.sh 'production service restart set'
require_grep 'https://${SESSIONS_DOMAIN}/ready' scripts/deploy-production.sh 'post-deploy readiness check'
require_grep 'SESSIONS_RELEASE_ID' scripts/deploy-production.sh 'release identity tracking'
require_grep 'ROLLBACK_REF' scripts/rollback-production.sh 'rollback ref support'
require_grep 'SESSIONS_SLO_READY_MS' scripts/check-production-slo.sh 'SLO readiness threshold'

require_grep '/webhooks/stripe' infrastructure/docker/Caddyfile 'Stripe webhook route'
require_grep 'reverse_proxy billing:4100' infrastructure/docker/Caddyfile 'billing proxy'
require_grep 'reverse_proxy auth:4200' infrastructure/docker/Caddyfile 'auth proxy'
require_grep 'legacyGitImport' infrastructure/docker/Caddyfile 'legacy Git import compatibility route'
require_grep 'reverse_proxy repositories:4300' infrastructure/docker/Caddyfile 'repository proxy'
require_grep 'workflowControl' infrastructure/docker/Caddyfile 'workflow control route'
require_grep 'reverse_proxy workflows:4400' infrastructure/docker/Caddyfile 'workflow proxy'
require_grep 'reverse_proxy api:4000' infrastructure/docker/Caddyfile 'API proxy'
require_grep 'header Authorization *' infrastructure/docker/Caddyfile 'authorization forwarding'
require_grep 'rewrite * /api/sessions' infrastructure/docker/Caddyfile 'session route rewrite'

for schema in \
  infrastructure/postgres/012-sessions-native-repository.sql \
  infrastructure/postgres/013-team-invitations.sql \
  infrastructure/postgres/014-action-workflows.sql; do
  test -s "$schema" || { echo "Production qualification missing schema: $schema" >&2; exit 1; }
done

require_grep 'sessions_repository_objects' infrastructure/postgres/012-sessions-native-repository.sql 'native source object storage'
require_grep 'workspace_invitations' infrastructure/postgres/013-team-invitations.sql 'team invitation schema'
require_grep 'repository_action_workflows' infrastructure/postgres/014-action-workflows.sql 'workflow definition schema'
require_grep 'customer_workflow' infrastructure/postgres/014-action-workflows.sql 'customer-workflow execution kind'

# Check executor security semantics without depending on source minification/formatting.
require_grep '"--network"' apps/runner/src/workflow-executor.ts 'explicit Docker network policy flag'
require_grep 'defaultNetwork: "none"' apps/runner/src/workflow-executor.ts 'deny-by-default executor network'
require_grep '"--read-only"' apps/runner/src/workflow-executor.ts 'read-only executor root filesystem'
require_grep '"--cap-drop"' apps/runner/src/workflow-executor.ts 'capability drop in executor'
require_grep '"ALL"' apps/runner/src/workflow-executor.ts 'drop all Linux capabilities'
require_grep '"no-new-privileges:true"' apps/runner/src/workflow-executor.ts 'no-new-privileges executor policy'
require_grep 'secretsRedacted: true' apps/runner/src/workflow-executor.ts 'secret redaction evidence'

echo 'Production Compose, commercial auth/billing, Sessions-native source control, customer workflows, isolated execution, and operational deployment configuration validated.'
