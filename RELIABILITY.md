# Sessions Reliability Doctrine

Sessions exists to make collaborative software execution by AI systems, AI agents, and humans more predictable, observable, recoverable, and trustworthy.

## Mandatory properties

Every critical subsystem must support, where applicable:

- idempotency;
- retryability;
- rollback;
- replayability;
- auditability;
- observability;
- failure isolation;
- explicit error propagation;
- integrity verification.

## Non-negotiable rules

1. Never trust generated output merely because an AI produced it.
2. Never silently swallow consequential failures.
3. Never mutate critical historical records in place.
4. Never allow consequential execution without attributable actor identity.
5. Never claim replay when reconstruction cannot be verified.
6. Never claim deterministic model reasoning when the provider cannot guarantee it.

## Snapshot reliability

CodeVault snapshots must be immutable, checksummed, reconstructable, and independently verifiable.

A snapshot is considered restorable only when the reconstructed state hashes to the recorded digest.

## Verification reliability

Verification results must identify:

- what check ran;
- the exact command or adapter;
- start and finish time;
- exit status;
- evidence/output reference;
- actor or system that requested it;
- repository/session/snapshot context.

## Deployment reliability

Every production deployment path must eventually support health checks, verification evidence, a known rollback target, deployment history, and failure isolation.

## Execution reliability

Human, AI-agent, AI-system, and service activity must all be traceable through the same event envelope while preserving actor type and authority boundaries.

## Memory reliability

Durable memory must carry provenance, confidence where relevant, lifecycle state, and lineage. Authenticity does not equal authority: persisted AI-generated state remains untrusted until current policy and authorization permit its use.

## Observability

Target telemetry stack:

- OpenTelemetry
- structured logs
- Prometheus-compatible metrics
- Grafana dashboards
- Loki-compatible log aggregation
- distributed tracing

Important product metrics include:

- snapshot creation success rate;
- snapshot restore success rate;
- replay reconstruction success rate;
- rollback success rate;
- verification completion/pass rate;
- timeline ingestion failures;
- duplicate-event suppression;
- queue latency;
- API p95/p99 latency;
- runner startup latency;
- model/provider failure rate;
- cost and tokens per Session.

## Failure recovery model

Critical workflows use five recovery tools:

**Retry** — for bounded transient failure.

**Rollback** — for restoring a verified stable state.

**Replay** — for reconstructing recorded execution and deterministic system actions where possible.

**Isolation** — to prevent cascading failure across repositories, workspaces, runners, and tenants.

**Audit** — to establish what happened, who/what acted, and which evidence supports the conclusion.

## Testing hierarchy

- unit tests;
- integration tests;
- end-to-end tests;
- replay/reconstruction tests;
- targeted failure-injection tests;
- load tests;
- security tests.

Early failure injection should cover duplicate events, interrupted runners, Redis/queue failure, object-storage write failure, database transaction failure, model-provider errors, webhook retries, and corrupted snapshot data.

## Performance doctrine

Infrastructure must feel fast. Prefer asynchronous work, bounded queues, incremental indexing, streaming results, cacheable immutable objects, and isolated worker pools over blocking request paths.

## Scale sequence

### V1

- modular application architecture;
- PostgreSQL;
- Redis/BullMQ;
- Docker runners;
- S3-compatible storage;
- OpenTelemetry.

### V2

Extract services only when measurements justify it. Add horizontal worker scaling, stronger event infrastructure, and orchestration as usage demands.

### V3

Multi-region and globally distributed execution/replay infrastructure only after real workload and customer requirements establish the need.
