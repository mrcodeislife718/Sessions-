# Sessions Architecture

## Purpose

Sessions is a native software development platform for AI systems, AI agents, and humans.

The architecture combines three independent first-class layers:

```text
SESSIONS
├── Source Control
├── Collaboration
└── Intelligence
```

Sessions owns its repository model, history model, collaboration model, execution model, verification model, recovery model, and deployment model.

## Native source-control model

### Repository

The Repository is the durable container for source objects, Workstreams, Checkpoints, history, reviews, verification, releases, deployment state, and execution lineage.

### Workstream

A Workstream is a purpose-oriented line of development tied to an objective. It owns a current head Checkpoint and can evolve independently until integration.

### Checkpoint

A Checkpoint is an immutable meaningful software state.

```text
Checkpoint
├── id
├── friendlyName
├── repositoryId
├── workstreamId
├── parentCheckpointIds[]
├── sourceManifest
├── sourceDigest
├── semanticSummary
├── objectiveId
├── actors[]
├── executionRefs[]
├── verificationRefs[]
├── risk
├── lifecycle
├── createdAt
└── recoveryMetadata
```

Checkpoint lifecycle:

```text
Draft → Verified → Reviewed → Approved → Published
```

### Change Review

A Change Review combines source differences, semantic changes, objective, actors, verification evidence, risk, approvals, and recovery readiness.

### Integrate

Integration combines qualified Workstreams while checking source conflicts, semantic conflicts, overlapping work, verification gates, authority requirements, and recovery readiness.

### Publish and Sync

Publication and synchronization exchange native repository objects, Checkpoint graphs, Workstream heads, and integrity metadata between Sessions installations.

The synchronization layer must support missing-object negotiation, resumable transfer, concurrent-update detection, offline reconciliation, and independent integrity verification.

## Repository object model

```text
Repository
├── metadata
├── objects/
│   ├── source blobs
│   ├── manifests
│   └── semantic objects
├── workstreams/
├── checkpoints/
├── reviews/
├── verification/
├── sessions/
├── releases/
└── state
```

Local metadata lives under `.sessions/` and is owned exclusively by Sessions.

Content-addressed objects are immutable. Human-readable names are references, not integrity identities.

## Actor model

Every consequential action has an attributable actor.

Supported actor kinds:

- `human`
- `ai_agent`
- `ai_system`
- `service`

Actor authority is capability-scoped. Identity never automatically implies permission.

## Event envelope

All engines communicate through a common event envelope:

```text
Event
├── id
├── type
├── occurredAt
├── workspaceId
├── projectId
├── repositoryId
├── workstreamId
├── sessionId
├── checkpointId
├── actor
├── correlationId
├── causationId
└── payload
```

## Core engines

### Native Repository Engine

Owns repository creation, source objects, manifests, Workstreams, Checkpoint graph, status, change detection, diffs, integration, publication, synchronization, and local repository state.

### CodeVault

Owns immutable content-addressed state, digests, reconstruction inputs, integrity verification, and recovery targets.

### Timeline Engine

Stores ordered execution and development events and provides reconstruction, activity, progress, and replay views.

### Verification Engine

Produces structured evidence from lint, type checks, tests, builds, security, policy, approvals, and future verification adapters.

### Semantic Engine

Adds system-level interpretation: affected components, dependencies, architectural intent, behavioral impact, risk, semantic change, and semantic conflict analysis.

### Memory Graph

Promotes qualified engineering knowledge from execution history into durable memory with provenance and lifecycle controls.

### Execution Runtime

Coordinates humans, AI systems, AI agents, services, tools, commands, approvals, authority, and execution budgets.

### Collaboration Platform

Owns organizations, teams, hosted repositories, Work Items, Change Reviews, approvals, activity, notifications, search, audit, identity, packages, releases, and dashboards.

### Deployment Runtime

Binds qualified Checkpoints and releases to environments, deployment events, health checks, recovery targets, and post-deployment evidence.

## Canonical data flow

```text
Actor defines Goal
    ↓
Workstream created or selected
    ↓
Session begins
    ↓
Human / AI System / AI Agent execution
    ↓
Source changes detected
    ↓
Checkpoint created
    ↓
Verification evidence attached
    ↓
Change Review
    ↓
Integrate
    ↓
Publish / Sync
    ↓
Release / Deploy
    ↓
Replay / Recovery / Restore
```

## Progress architecture

Progress is derived from observable state, not invented percentages.

Progress signals include:

- objective state;
- Workstream milestones;
- Session events;
- actor contributions;
- Checkpoint creation;
- verification completion;
- review state;
- integration state;
- publication state;
- release state;
- deployment state;
- recovery readiness.

## Integrity

Source objects and Checkpoints use cryptographic content digests. Reconstructed state must be independently hashed before Sessions declares restoration successful.

## Replay semantics

Sessions distinguishes:

1. timeline replay;
2. state reconstruction;
3. deterministic action replay where safe;
4. AI-model re-execution, which is not assumed to reproduce identical internal reasoning.

## Trust boundary

Persisted AI-generated state is data, not automatically trusted instruction. Provenance and authenticity do not imply authority. Consequential use requires current authorization and policy evaluation.

## Developer-experience rule

Sessions should infer bookkeeping wherever it can do so safely. The platform should expose intent and outcomes first, with low-level implementation detail available through progressive disclosure.
