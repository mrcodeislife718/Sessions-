# Sessions Architecture

## Purpose

Sessions is AI-native source control and execution infrastructure for AI systems, AI agents, and humans.

The architecture treats software change as an attributable execution process rather than only a file diff.

## Actor model

Every consequential action has an actor.

Supported actor kinds:

- `human`
- `ai_agent`
- `ai_system`
- `service`

An actor record contains a stable ID, display name, kind, optional provider/model metadata, and optional parent actor. Parent relationships allow a larger AI system to coordinate child agents without erasing lineage.

## Event envelope

All core engines communicate through a common event envelope:

```text
Event
├── id
├── type
├── occurredAt
├── workspaceId
├── projectId
├── repositoryId
├── sessionId
├── actor
├── correlationId
├── causationId
└── payload
```

`correlationId` groups activity belonging to the same higher-level operation. `causationId` links an event to the event that directly caused it.

## Core engines

### CodeVault

Owns immutable snapshot manifests, content digests, checkpoint identities, reconstruction inputs, and rollback targets.

### Timeline

Stores ordered execution events and provides reconstruction views. Timeline is append-oriented. Corrections create new events rather than mutating critical history.

### Verification

Produces structured evidence from lint, typecheck, tests, builds, security hooks, policy checks, and future verification adapters.

### Semantic Engine

Adds system-level interpretation: components, dependencies, architectural intent, affected areas, risk, and semantic relationships.

### Memory Graph

Promotes qualified engineering knowledge from execution history into durable memory with provenance and lifecycle controls.

### Execution Runtime

Coordinates human actions, AI systems, AI agents, services, tool calls, commands, approvals, and budgets while preserving authority boundaries.

### Deployment Runtime

Binds verified snapshots to environments, releases, health checks, rollback targets, and post-deployment evidence.

## Data flow

```text
Actor starts Session
    ↓
SessionStarted event
    ↓
Repository baseline captured by CodeVault
    ↓
SnapshotCreated event
    ↓
Human / AI System / AI Agent activity
    ↓
Tool/command/change events
    ↓
Verification run
    ↓
Verification evidence events
    ↓
Timeline finalized
    ↓
Deployment approved or blocked
    ↓
Replay / Recovery / Rollback available
```

## Integrity

Snapshots use canonical JSON plus SHA-256 digests. Content-addressed objects should be immutable. Reconstructed state must be re-hashed before Sessions declares restoration successful.

## Replay semantics

Sessions distinguishes:

1. **timeline replay** — re-reading the recorded event sequence;
2. **state reconstruction** — rebuilding a repository/software state from immutable recorded inputs;
3. **action replay** — re-running deterministic system operations where safe and authorized;
4. **model re-execution** — invoking an AI model again, which is not assumed to produce identical reasoning or output.

This distinction prevents false claims of deterministic AI reasoning replay.

## Trust boundary

Persisted AI-generated state is data, not automatically trusted instruction. Provenance and authenticity are necessary but do not imply current authority. Stored state must be re-authorized when consumed in a consequential workflow.

## Initial package boundaries

```text
packages/
├── shared/              # actor IDs, event envelope, canonical utilities
├── codevault-core/      # immutable snapshot primitives
├── timeline-engine/     # ordered event capture and reconstruction
└── verification-engine/ # structured verification evidence
```

These packages are intentionally dependency-light. Hosted services, persistence adapters, queues, UI, and model providers are layered on top rather than embedded into the primitives.
