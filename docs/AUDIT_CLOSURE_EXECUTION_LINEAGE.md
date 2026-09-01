# Sessions Audit-Closure Execution Lineage

## Scope lock

Sessions already has the core repository, timeline, memory, semantic, verification, auth, billing and production infrastructure. This branch may only add the approved execution-history capability by integrating it into existing causal/reasoning infrastructure. No parallel history product, placeholder, mock, speculative UI or unrelated feature is permitted.

Approved history must preserve:
- why work happened;
- objective/task identity;
- logical worker and provider/model session identity;
- authority decision and approval;
- repository/branch/worktree;
- actual tool/command/file changes;
- before/after hashes where available;
- tests and verification evidence;
- failures, retries and repairs;
- checkpoints/rollback;
- completion/failure outcome;
- downstream consequences.

## Architecture

Existing Sessions event/timeline -> execution-lineage projection -> existing causal graph/semantic relationships -> verification lineage -> query APIs.

The execution-lineage layer does not replace existing events. It adds normalized relationships and constraints so the system can answer why an action occurred and what evidence established its outcome.

## Evidence plan

### Normalized execution event contract
Purpose: make Codeable/Dev-Zero/Axion execution events interoperable with Sessions.
Mechanism: typed event envelope with objective, task, actor, logical worker, provider/model session, authority, repository context, causation/correlation, operation, hashes, verification and recovery fields.
Expected advantage: complete cross-runtime history without coupling Sessions to one model or worker runtime.
Tradeoff: producers must provide normalized identifiers.
Failure mode: missing causal parent, cross-session ancestry, or contradictory identifiers.
Measurement: validation/rejection tests.
Benchmark: invalid ancestry and missing required identifiers are rejected deterministically.
Fallback: preserve raw event as quarantined/unqualified evidence rather than promote it into causal lineage.
Validation: contract and persistence tests.

### Verification lineage
Purpose: distinguish attempted work from proven work.
Mechanism: explicit edges from requirement/task -> operation/source change -> test/verification -> checkpoint/commit -> deployment/outcome.
Expected advantage: completion claims remain evidence-backed.
Tradeoff: more relationships per task.
Failure mode: verification is recorded without linking to the change it proves.
Measurement: graph consistency checks.
Benchmark: no qualified completion may exist without required verification linkage.
Fallback: status remains unverified.
Validation: end-to-end lineage test.

### Repair and failure history
Purpose: preserve failed attempts rather than rewriting history to show only success.
Mechanism: immutable failure/retry/replan/rollback events linked to subsequent repair attempts.
Expected advantage: better diagnosis, learning and auditability.
Tradeoff: higher event volume.
Failure mode: event explosion under retry loops.
Measurement: bounded retry lineage and storage growth.
Benchmark: retry chains remain traversable and bounded by task policy.
Fallback: collapse repetitive diagnostics into referenced evidence records while preserving causal events.
Validation: repeated-failure scenario.

## Scale analysis

1x: one task chain; prioritize complete causality.
10x: parallel workers require correlation/worktree identities and deterministic merge of event order.
100x: event volume becomes dominant; indexes, pagination, retention tiers and materialized relationships must avoid full-history scans.

Success-too-well risk: high-throughput agents can generate more lineage than humans can inspect. Sessions must preserve complete evidence while providing bounded summaries/projections, never deleting the underlying causal record solely for convenience.
