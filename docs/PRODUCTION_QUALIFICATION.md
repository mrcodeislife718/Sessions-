# Sessions Production Qualification

`launch/sessions-production` may be promoted to `main` only when the automated production qualification gates are green and the remaining external commercial proof gates are evidenced.

## Automated release gates

Required GitHub Actions jobs:

1. `verify (Node 22)`
2. `verify (Node 24)`
3. `PostgreSQL migration / backup / restore qualification`
4. `lifecycle / recovery end-to-end qualification`
5. `production deployment configuration qualification`

A failing gate is a product defect. Do not disable, skip, or weaken a gate merely to make the branch green.

## Database qualification

`bash scripts/qualify-postgres.sh` must prove:

- clean database creation;
- ordered migration application;
- idempotent migration reapplication;
- representative repository/session/event/snapshot/verification persistence;
- organization/workspace/principal/membership persistence;
- billing, usage, product telemetry and recovery experiment persistence;
- custom-format database backup;
- independent restore into a separate database;
- restored evidence, verification, audit and recovery records.

Production backups use `scripts/backup-production.sh`. Restores use `scripts/restore-production.sh` and require an explicit destructive-operation confirmation plus checksum verification.

## Security qualification

Production must keep `SESSIONS_ALLOW_INSECURE_LOCAL=false`.

Hosted access requires a workspace-scoped bearer credential. Only the SHA-256 token digest is stored. API operations enforce explicit scopes, workspace isolation, request-body limits, rate limiting and audit records for consequential actions.

The local insecure identity exists only for deliberate local-development/qualification use.

## Recovery qualification

`node scripts/qualify-lifecycle.mjs` creates a real database-backed Session and records work, source change, command execution, snapshot, verification and deployment events. It then reconstructs continuation state from persisted Session identity rather than process-local context.

The run reports:

- recovery latency;
- recovered event count;
- missing required context;
- reproduction success;
- continuation readiness.

This automated experiment establishes that the mechanism works. It does **not** by itself prove market superiority.

## Production deployment

`bash scripts/validate-production-config.sh` must verify the production Compose render includes:

- production-only authentication mode;
- explicit CORS origin;
- all production migrations;
- read-only application containers where practical;
- privilege reduction;
- internal control/data/runner networks;
- readiness-based API health checks.

Before an actual release, operators must additionally verify TLS issuance, DNS, external storage durability, backup destination durability, alerts and rollback from the target hosting environment.

## Commercial operations

Hosted workspaces are provisioned with `scripts/provision-workspace.sh`. The command creates organization/workspace/principal ownership, a billing/subscription record and one workspace-scoped API token whose raw value is displayed once.

Commercial logic must enforce plan entitlements, quotas and subscription state. `past_due`, `paused` and `canceled` states cannot silently retain paid-service entitlement.

Product telemetry must support activation and retention measurement without fabricating usage. Relevant views include `workspace_activation_summary`, `workspace_weekly_activity`, `paid_workspace_status` and `recovery_proof_summary`.

## Superiority proof

Use `scripts/score-recovery-experiments.mjs` with experiments collected under a preregistered protocol. At minimum compare Sessions with an ordinary Git + chat/history baseline on the same interrupted engineering objectives.

Measure:

- orientation time;
- missing-context count;
- reconstruction accuracy;
- reproduction success;
- continuation readiness.

The smoke fixture under `test/fixtures/` exists only to verify scoring software and must never be presented as product evidence.

## External gates that automation cannot manufacture

PR #4 must remain unmerged until the release decision has credible evidence for the external gates that are required for the commercial-completion claim:

- real developer onboarding in the intended hosted environment;
- repeated real usage;
- paid conversion;
- retention/renewal evidence;
- measured superiority using real comparable tasks;
- demonstrated customer value.

Tests can prove software behavior. They cannot manufacture customers, revenue, retention or external superiority evidence.
