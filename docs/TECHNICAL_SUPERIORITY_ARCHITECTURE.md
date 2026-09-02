# Sessions Technical Superiority Architecture

## Scope

Sessions is evaluated independently as durable engineering memory, causal execution history, and evidence-linked repository intelligence.

## Competitive reference set

Relevant strengths to preserve or exceed:

- Event-sourced systems: append-only history, replayability, causation/correlation identifiers, deterministic reconstruction.
- Temporal-style durable histories: resumable execution records and explicit workflow state transitions.
- Observability systems: high-volume event ingestion, indexed querying, bounded retention, trace-style causal navigation.
- Provenance/lineage systems: attributable transformations and upstream/downstream dependency traversal.
- Git/GitHub history: durable immutable commits and repository-native evidence.

Structural weaknesses Sessions should avoid:

- loading entire histories into application memory for causal queries;
- treating timestamps as sufficient causality;
- losing failed attempts after successful repair;
- storing evidence without proving which requirement/change it qualifies;
- event schemas that become provider-specific;
- unbounded payload growth;
- mutable historical facts without correction lineage;
- expensive full-graph scans for common why/consequence queries.

## Improved architecture

### 1. Database-native bounded causal traversal

1. Purpose: keep why/causes/consequences queries fast and memory-bounded as histories grow.
2. Mechanism: recursive PostgreSQL traversal over causation relationships with session/workspace scoping, depth/result caps, and targeted indexes.
3. Expected advantage: application memory scales with returned results, not total session size.
4. Tradeoff: more SQL complexity and PostgreSQL dependence for hosted graph traversal.
5. Failure mode: pathological deep/wide graphs consume database resources.
6. Measurement: p50/p95 query latency, rows scanned, API RSS, database CPU.
7. Benchmark: causal query latency remains bounded on 1K/100K/1M-event synthetic histories for capped result sets.
8. Fallback: strict depth/result timeout and partial/truncated response.
9. Validation: deep chain, wide fan-out, cycle corruption, nonexistent target, and multi-tenant isolation tests.

### 2. Immutable facts with corrective events

1. Purpose: preserve trustworthy history without pretending ingestion is infallible.
2. Mechanism: material events remain immutable; corrections/supersessions are explicit events referencing the original fact.
3. Expected advantage: auditability and deterministic replay.
4. Tradeoff: consumers must understand effective/current versus historical state.
5. Failure mode: clients ignore correction relationships.
6. Measurement: replay consistency and correction-resolution accuracy.
7. Benchmark: identical effective state from repeated replay of the same ordered event set.
8. Fallback: projection APIs expose resolved state while raw history remains available.
9. Validation: inject incorrect fact, correct it, replay from zero, compare projection.

### 3. Evidence-to-claim qualification edges

1. Purpose: distinguish evidence existence from evidence relevance.
2. Mechanism: verification events explicitly bind requirement/task/change/test/result/commit relationships rather than storing disconnected proof blobs.
3. Expected advantage: stronger completion proof and better root-cause reasoning.
4. Tradeoff: producers must provide richer references.
5. Failure mode: incomplete producers create partially connected lineage.
6. Measurement: percentage of completed tasks with complete requirement-to-evidence chain.
7. Benchmark: 100% of qualified-complete tasks have at least one valid verification path.
8. Fallback: mark lineage incomplete/unqualified rather than invent missing edges.
9. Validation: missing test, stale commit, unrelated test, repaired failure, rollback scenarios.

### 4. Provider-neutral execution vocabulary

1. Purpose: remain useful across Qwen, Codex, Claude, humans, future agents, and non-AI automation.
2. Mechanism: stable semantic event types with provider/model details as attribution fields, not schema-defining concepts.
3. Expected advantage: interoperability and lower migration cost.
4. Tradeoff: provider-specific detail may live in bounded extension payloads.
5. Failure mode: generic types become too vague.
6. Measurement: schema churn per new provider and percentage of events requiring provider-specific core changes.
7. Benchmark: onboard a new provider with zero core migration for standard execution lineage.
8. Fallback: namespaced extension metadata with versioning.
9. Validation: replay equivalent task histories from three providers and one human actor through same queries.

### 5. Tiered evidence retention

1. Purpose: prevent successful adoption from turning history into unbounded hot-storage cost.
2. Mechanism: keep causal metadata/hashes hot; move large raw artifacts to object storage under retention rules while preserving content digests and references.
3. Expected advantage: predictable database size and lower cost.
4. Tradeoff: archived evidence retrieval has higher latency.
5. Failure mode: referenced artifact expires before required retention period.
6. Measurement: bytes/event, hot DB growth, archive retrieval latency, broken-reference rate.
7. Benchmark: bounded metadata size per event class and zero broken references inside declared retention window.
8. Fallback: legal/compliance pinning and configurable retention classes.
9. Validation: archive/restore/delete lifecycle with digest verification.

## 1x / 10x / 100x consequences

### 1x

Thousands of events. Simplicity and explanatory power dominate; ordinary indexes are sufficient.

### 10x

Hundreds of thousands to millions of events. In-memory whole-session traversal becomes unacceptable; database-native bounded traversal and artifact tiering become necessary.

### 100x

Large organizations and long-lived repositories can generate tens/hundreds of millions of events. Hot indexes, tenant isolation, partition strategy, retention, ingestion backpressure, and projection rebuilding dominate cost.

## Success-too-well failures

- Every tool action is recorded at excessive granularity, making useful history noisy and expensive.
- Verification artifacts outgrow source history.
- Causal fan-out makes consequence queries enormous.
- Popular repositories create hot partitions/indexes.
- Automated producers flood duplicate events after retries.

Controls: semantic materiality rules, idempotent event IDs, bounded query traversal, payload quotas, tiered artifacts, partition-ready schema, ingestion backpressure.

## Evidence plan

Required benchmark suites:

1. Ingestion throughput and duplicate-event behavior.
2. Why/causes/consequences p50/p95 at 1K, 100K, 1M events.
3. API RSS during bounded queries.
4. Deep/wide graph traversal and truncation correctness.
5. Multi-tenant isolation.
6. Replay determinism and correction handling.
7. Evidence-chain qualification accuracy.
8. Hot database bytes per million events and archived artifact cost.
9. New-provider schema compatibility.

No superiority claim is valid until measured against a named event/provenance baseline.