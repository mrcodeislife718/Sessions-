# Reasoning Graph Architecture

## Objective

Make the engineering record itself queryable as a causal graph, not merely an ordered activity log.

## Competitive strengths preserved

Durable execution systems demonstrate the value of append-oriented event histories, replay, deterministic recovery boundaries, and idempotent processing. Agent graph systems demonstrate the value of checkpointed state, resumability, human-in-the-loop control, and cross-run memory. Sessions preserves those strengths while binding them to immutable source state, attributable engineering decisions, verification evidence, deployment state, and recovery.

## Structural weaknesses Sessions avoids

- A source diff without the execution story.
- Chat history as the authoritative engineering record.
- Model-provider-specific memory.
- In-memory-only production history.
- Causal identifiers that are stored but never validated.
- Decision rationale hidden inside unstructured event payloads.
- Replay that assumes nondeterministic model calls reproduce identical internal reasoning.
- Knowledge promotion without provenance or confidence.

## Architecture

```text
Objective
  -> Session
  -> Decision / Assumption / Evidence
  -> Execution
  -> Source Change
  -> Checkpoint
  -> Verification
  -> Review / Integration
  -> Deployment
  -> Outcome / Recovery
```

Each graph node is an attributable Session event or an immutable engineering object. Each causal edge is explicit. `causationId` is a parent edge; `correlationId` groups related work without implying causality.

### First-class decision events

- DecisionProposed
- DecisionMade
- DecisionRejected
- AlternativeConsidered
- AssumptionRecorded
- EvidenceReferenced
- DecisionSuperseded
- OutcomeObserved

Decision payloads use stable identifiers and structured fields so they remain queryable without parsing prose.

### Causal integrity

A causal store must reject:

- self-causation;
- references to missing parent events unless explicitly imported as unresolved external ancestry;
- cross-session causal edges by default;
- cycles;
- duplicate event identifiers with conflicting contents.

### Traversal

The core API supports:

- `why(target)` — traverse ancestors toward objectives, decisions, evidence, and causes;
- `causes(event)` — direct parents;
- `consequences(source)` — descendants;
- `lineage(target)` — ordered causal subgraph plus actors and evidence.

Traversal is bounded by depth and result count to prevent runaway graph queries.

### Persistence

`InMemoryTimelineStore` remains for tests and ephemeral development only. Production uses a PostgreSQL store over `session_events` with idempotent insert semantics, stable ordering, indexed session lookup, and causal-reference validation inside a transaction.

### Memory Graph

Qualified engineering knowledge is promoted from evidence-bearing events into durable memory records with provenance, confidence, lifecycle, and supersession links. Memory never becomes authority merely because an AI created it.

### Semantic Engine

Semantic relationships are derived from repository state and events: components, dependencies, architectural decisions, known failures, successful fixes, risk, and behavior. Semantic output is evidence-linked and can be recomputed when analyzers change.

## Innovation evidence plan

### 1. First-class decisions

Purpose: make engineering rationale queryable.
Mechanism: typed decision events and structured payloads.
Expected advantage: direct decision search and impact analysis.
Tradeoff: stricter schemas increase capture complexity.
Failure mode: agents emit shallow or redundant decisions.
Measurement: percentage of production checkpoints with at least one attributable rationale path.
Benchmark: query a decision lineage without reading chat logs.
Fallback: retain generic event payload compatibility.
Validation: tests for typed creation, serialization, traversal, and supersession.

### 2. Causal integrity enforcement

Purpose: ensure the graph represents valid lineage rather than decorative IDs.
Mechanism: transactional parent validation, cycle prevention, and duplicate-content checks.
Expected advantage: trustworthy `why` and impact queries.
Tradeoff: extra write-time database reads.
Failure mode: high-ingest workloads create contention.
Measurement: event append p50/p95/p99 latency and rejected-invalid-edge count.
Benchmark: 10k-event session graph with bounded ancestry and descendant queries.
Fallback: asynchronous validation mode for imported legacy history, marked untrusted until validated.
Validation: adversarial tests for cycles, missing parents, cross-session edges, and duplicate IDs.

### 3. Durable timeline store

Purpose: survive process and machine loss.
Mechanism: PostgreSQL-backed TimelineStore.
Expected advantage: recovery, multi-process access, auditability.
Tradeoff: network/storage latency versus RAM.
Failure mode: database outage or slow queries.
Measurement: append/query latency, recovery point, replay completeness.
Benchmark: compare in-memory and PostgreSQL throughput while requiring durable acknowledgement.
Fallback: bounded local spool for temporary database unavailability; never claim persistence before durable acknowledgement.
Validation: restart/reconnect integration test and idempotent append test.

### 4. Memory + semantic engines

Purpose: convert history into reusable engineering knowledge without losing provenance.
Mechanism: confidence-scored memory records and evidence-linked semantic relationships.
Expected advantage: faster continuation, less repeated investigation, safer AI handoffs.
Tradeoff: indexing/storage cost and stale-analysis risk.
Failure mode: incorrect knowledge promoted as durable truth.
Measurement: retrieval precision, stale-memory rate, provenance coverage, continuation time saved.
Benchmark: recover a known fix/decision from history without replaying entire sessions.
Fallback: raw event/history traversal remains canonical.
Validation: provenance, confidence, supersession, invalidation, and recomputation tests.

## Scale analysis

### 1x

Single repository/team. PostgreSQL indexes on session and causal IDs are sufficient. Traversal remains interactive.

### 10x

Many concurrent agents and repositories. Add batched inserts, prepared statements, pagination, per-workspace quotas, and background semantic indexing. Track hot sessions and graph fan-out.

### 100x

Very high event volume creates write amplification, unbounded histories, graph hotspots, and expensive descendant traversal. Partition by workspace/repository/time, archive cold payloads to object storage, maintain compact adjacency/index tables, and compute materialized lineage summaries for hot targets. Preserve immutable source/evidence digests even when payloads move to colder tiers.

## Success-too-well risks

- Agents generate more provenance than humans can inspect.
- Event histories grow faster than semantic indexes can process them.
- High fan-out decisions make descendant traversal expensive.
- Memory promotion floods the system with low-value facts.
- Customers depend on Sessions lineage as a compliance record before retention/export controls are mature.

Mitigations: bounded traversal, compaction without destroying integrity, tiered retention, confidence thresholds, sampling only for non-authoritative telemetry, and explicit compliance/export controls.
