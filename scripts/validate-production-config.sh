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
export SESSIONS_ACTION_SECRET_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
export SESSIONS_WEBHOOK_MASTER_KEY="qualification-webhook-master-key-at-least-32-bytes"
export STRIPE_SECRET_KEY="sk_test_qualification"
export STRIPE_WEBHOOK_SECRET="whsec_qualification"
export STRIPE_PRICE_DEVELOPER="price_qualification"

rendered="$(mktemp -t sessions-compose.XXXXXX.yml)"
trap 'rm -f "$rendered"' EXIT
docker compose -f docker-compose.production.yml config > "$rendered"

require_grep(){ local pattern="$1" file="$2" label="$3"; grep -Fq -- "$pattern" "$file" || { echo "Production qualification missing: $label" >&2; echo "  expected literal: $pattern" >&2; return 1; }; }
require_regex(){ local pattern="$1" file="$2" label="$3"; grep -Eq -- "$pattern" "$file" || { echo "Production qualification missing: $label" >&2; echo "  expected pattern: $pattern" >&2; return 1; }; }

for invariant in \
  'SESSIONS_ALLOW_INSECURE_LOCAL: "false"' \
  'SESSIONS_CORS_ORIGIN: https://qualification.sessions.invalid' \
  'SESSIONS_ACTION_SECRET_KEY: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' \
  'SESSIONS_WEBHOOK_MASTER_KEY: qualification-webhook-master-key-at-least-32-bytes' \
  'SESSIONS_ALLOW_INSECURE_WEBHOOKS: "false"' \
  'STRIPE_SECRET_KEY: sk_test_qualification' \
  'STRIPE_WEBHOOK_SECRET: whsec_qualification' \
  'STRIPE_PRICE_DEVELOPER: price_qualification' \
  'DOCKER_HOST: unix:///var/run/docker.sock' \
  'SESSIONS_JOB_VOLUME: sessions_jobs' \
  'SESSIONS_ACTION_MEMORY: 1g'; do require_grep "$invariant" "$rendered" "production compose invariant $invariant"; done
require_regex 'source: .*/infrastructure/postgres' "$rendered" 'canonical migration directory mount'
require_grep 'target: /sessions-migrations' "$rendered" 'canonical migration directory target'
require_regex 'source: .*/infrastructure/docker/init-postgres\.sh' "$rendered" 'fresh database migration runner mount'
require_grep 'target: /docker-entrypoint-initdb.d/001-sessions-migrations.sh' "$rendered" 'fresh database migration runner target'
require_regex 'source: /var/run/docker\.sock' "$rendered" 'executor Docker socket source mount'
require_regex 'target: /var/run/docker\.sock' "$rendered" 'executor Docker socket target mount'
require_regex 'SESSIONS_ACTION_CPUS: ("?1\.0"?|1)' "$rendered" 'executor CPU limit'
for invariant in 'read_only: true' 'no-new-privileges:true' 'internal: true'; do require_grep "$invariant" "$rendered" "container hardening $invariant"; done

mapfile -t migrations < <(bash scripts/list-migrations.sh)
[[ "${#migrations[@]}" -ge 2 ]] || { echo 'Canonical migration list is unexpectedly empty' >&2; exit 1; }
[[ "${migrations[0]}" == */infrastructure/postgres/init.sql ]] || { echo 'init.sql is not first migration' >&2; exit 1; }
latest="$(basename "${migrations[${#migrations[@]}-1]}")"
[[ "$latest" =~ ^[0-9]{3}-.+\.sql$ ]] || { echo "Unexpected latest migration name: $latest" >&2; exit 1; }
require_grep 'mapfile -t migrations < <(bash scripts/list-migrations.sh)' scripts/deploy-production.sh 'deploy uses canonical migration order'

require_grep 'private-runners:' "$rendered" 'private runner production topology service'
require_regex 'PRIVATE_RUNNER_PORT: "?4600"?' "$rendered" 'private runner production topology port'
require_regex 'SESSIONS_PRIVATE_RUNNER_LEASE_SECONDS: "?120"?' "$rendered" 'private runner production topology lease'

for script in scripts/backup-production.sh scripts/restore-production.sh scripts/deploy-production.sh scripts/rollback-production.sh scripts/check-production-slo.sh scripts/provision-workspace.sh scripts/seed-billing-qualification.sh scripts/qualify-current-postgres.sh scripts/qualify-current-recovery.sh scripts/qualify-webhook-outbox.sh scripts/qualify-release-governance.sh scripts/qualify-native-webhooks.sh scripts/qualify-repository-lifecycle.sh scripts/qualify-supply-chain.sh; do test -s "$script"; bash -n "$script"; done
require_grep 'backup-production.sh' scripts/deploy-production.sh 'pre-deploy backup'
require_grep 'build --pull api auth billing repositories workflows private-runners webhooks webhook-worker web runner executor' scripts/deploy-production.sh 'complete production image build set'
require_grep 'up -d --no-deps api auth billing repositories workflows private-runners webhooks webhook-worker runner executor' scripts/deploy-production.sh 'complete application restart set'
require_grep 'SESSIONS_ACTION_SECRET_KEY is required' scripts/deploy-production.sh 'Actions key deploy precondition'
require_grep 'SESSIONS_WEBHOOK_MASTER_KEY is required' scripts/deploy-production.sh 'webhook key deploy precondition'
require_grep 'private_runners_code=' scripts/deploy-production.sh 'private runner readiness check'
require_grep 'https://${SESSIONS_DOMAIN}/ready' scripts/deploy-production.sh 'post-deploy readiness check'
require_grep 'SESSIONS_RELEASE_ID' scripts/deploy-production.sh 'release identity tracking'
require_grep 'ROLLBACK_REF' scripts/rollback-production.sh 'rollback ref support'
require_grep 'SESSIONS_SLO_READY_MS' scripts/check-production-slo.sh 'SLO readiness threshold'

for route in '/webhooks/stripe' '/api/organization/security-policy' '/api/organization/audit-export' '/api/organization/retention-policy' '/api/organization/retention-sweep' '/api/private-runners' '/api/private-runner/*' 'runner-policy' 'reverse_proxy private-runners:4600' 'reverse_proxy repositories:4300' 'reverse_proxy workflows:4400' 'reverse_proxy webhooks:4500' 'reverse_proxy api:4000'; do require_grep "$route" infrastructure/docker/Caddyfile "production route $route"; done

for schema in infrastructure/postgres/012-sessions-native-repository.sql infrastructure/postgres/014-action-workflows.sql infrastructure/postgres/018-protected-branch-governance.sql infrastructure/postgres/019-webhook-outbox.sql infrastructure/postgres/020-release-deployment-governance.sql infrastructure/postgres/021-native-repository-webhook-events.sql infrastructure/postgres/022-repository-lifecycle.sql infrastructure/postgres/023-supply-chain-attestations.sql infrastructure/postgres/024-signing-keys.sql infrastructure/postgres/025-attestation-binding-lifecycle.sql infrastructure/postgres/026-organization-security-policy.sql infrastructure/postgres/027-lifecycle-purge-bypass.sql infrastructure/postgres/028-enterprise-audit-retention.sql infrastructure/postgres/029-private-runners.sql; do test -s "$schema" || { echo "Production qualification missing schema: $schema" >&2; exit 1; }; done
require_grep 'organization_retention_policies' infrastructure/postgres/028-enterprise-audit-retention.sql 'enterprise retention schema'
require_grep 'organization_audit_events' infrastructure/postgres/028-enterprise-audit-retention.sql 'organization audit export projection'
require_grep 'private_runners' infrastructure/postgres/029-private-runners.sql 'private runner registry'
require_grep 'repository_runner_policies' infrastructure/postgres/029-private-runners.sql 'repository runner policy'
require_grep "'private_workflow'" infrastructure/postgres/029-private-runners.sql 'strict-private execution kind'
require_grep 'sessions_apply_runner_policy' infrastructure/postgres/029-private-runners.sql 'runner scheduling policy trigger'
require_grep "current_setting('sessions.lifecycle_purge',true)" infrastructure/postgres/027-lifecycle-purge-bypass.sql 'controlled purge authorization check'

for invariant in 'organization.audit_export' 'organization.retention_policy.update' 'organization.retention_sweep' 'legal hold'; do require_grep "$invariant" apps/api/src/enterprise-governance.ts "enterprise governance $invariant"; done
for invariant in 'Runner ' 'runner_lease_expires_at' "execution_target in ('private','either')" 'required workflow secrets are missing' 'private_runner.job_complete'; do require_grep "$invariant" apps/api/src/private-runner-server.ts "private runner runtime $invariant"; done
require_grep "execution_kind='customer_workflow'" apps/runner/src/workflow-executor.ts 'hosted executor excludes strict private jobs'
require_grep '"--network"' apps/runner/src/workflow-executor.ts 'explicit Docker network policy flag'
require_grep 'defaultNetwork: "none"' apps/runner/src/workflow-executor.ts 'deny-by-default executor network'
require_grep '"--read-only"' apps/runner/src/workflow-executor.ts 'read-only executor root filesystem'
require_grep '"--cap-drop"' apps/runner/src/workflow-executor.ts 'capability drop in executor'
require_grep '"no-new-privileges:true"' apps/runner/src/workflow-executor.ts 'no-new-privileges executor policy'
require_grep 'secretsRedacted: true' apps/runner/src/workflow-executor.ts 'secret redaction evidence'

echo "Production topology validated through $latest: source control, commerce, recovery, organization governance, audit retention/legal hold, supply-chain evidence, hosted Actions, and governed private runners are wired consistently."
