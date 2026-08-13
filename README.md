# Sessions

**Native software development infrastructure for AI systems, AI agents, and humans.**

Sessions is an independent source-control, collaboration, execution, verification, recovery, and deployment platform designed for modern software development.

Sessions is not a wrapper around another source-control or collaboration system. It owns its own development model, repository state, workstreams, checkpoints, reviews, verification, activity history, releases, deployments, permissions, execution lineage, memory, replay, recovery, and rollback.

## Product mission

Make software development simpler, more understandable, more verifiable, more recoverable, and more collaborative for humans and AI.

## The developer promise

Sessions should make a developer's life easier before it asks them to learn a new infrastructure model.

It is designed to reduce:

- reconstruction work;
- source-control bookkeeping;
- review overhead;
- verification uncertainty;
- context switching;
- recovery time;
- fragmented development history.

The first product experience should answer, in seconds:

1. What is being worked on?
2. Who or what is working on it?
3. What changed?
4. Why did it change?
5. What progress has been made?
6. What was verified?
7. What failed?
8. What state is safe?
9. Can I replay how we got here?
10. Can I restore safely?

## Three platform layers

```text
SESSIONS
│
├── Source Control
│   ├── Repositories
│   ├── Workstreams
│   ├── Checkpoints
│   ├── History
│   ├── Diffs
│   ├── Integrate
│   ├── Restore
│   ├── Publish
│   ├── Local/offline operation
│   ├── Content integrity
│   └── Distributed synchronization
│
├── Collaboration
│   ├── Organizations
│   ├── Teams
│   ├── Permissions
│   ├── Work Items
│   ├── Change Reviews
│   ├── Approvals
│   ├── Activity
│   ├── Search
│   ├── Notifications
│   ├── Verification
│   ├── Runners
│   ├── Releases
│   ├── Deployments
│   ├── APIs
│   ├── Webhooks
│   ├── Packages / Artifacts
│   ├── Dashboards
│   ├── Audit
│   └── Developer identity
│
└── Intelligence
    ├── Human execution lineage
    ├── AI-system execution lineage
    ├── AI-agent execution lineage
    ├── Objectives and intent
    ├── Tool and command history
    ├── Semantic state
    ├── Verification lineage
    ├── Engineering memory
    ├── Causal timeline
    ├── Replay
    ├── Recovery
    ├── Trust evidence
    └── Semantic rollback
```

## Sessions-native development model

The core workflow is intentionally simpler than traditional source-control mechanics:

```text
Goal
  ↓
Workstream
  ↓
Session
  ↓
Checkpoint
  ↓
Verify
  ↓
Review
  ↓
Integrate
  ↓
Publish
  ↓
Release
  ↓
Deploy
```

### Repository

A Sessions repository is the native container for source, history, workstreams, checkpoints, reviews, verification, releases, deployment state, and execution lineage.

### Workstream

A Workstream represents an active line of development tied to a meaningful objective. Developers work with purpose-oriented Workstreams rather than managing source-control mechanics as the primary mental model.

### Session

A Session records the attributable execution story of work performed by humans, AI systems, AI agents, and services.

### Checkpoint

A Checkpoint is a first-class immutable state of the software. It captures source state, semantic change, objective, actors, execution lineage, verification evidence, integrity, parent state, and recovery metadata.

Checkpoint lifecycle:

```text
Draft → Verified → Reviewed → Approved → Published
```

### Change Review

A Change Review is the native review object for a Workstream or Checkpoint. It combines semantic change, raw source differences, objective, actors, verification evidence, risk, approvals, and recovery information.

### Integrate

Integrate combines approved work into the target Workstream while checking source differences, semantic conflicts, verification evidence, overlapping work, policy requirements, and rollback readiness.

### Publish

Publish makes a qualified state available to the shared Sessions repository and collaboration platform.

### Restore

Restore returns software to a known Checkpoint through preview, integrity verification, reconstruction, post-restore verification, and auditable recovery.

## Core execution loop

```text
Human / AI System / AI Agent Goal
              ↓
Collaborative Execution
              ↓
Sessions records progress
              ↓
CodeVault preserves source state
              ↓
Checkpoint captures meaningful state
              ↓
Verification validates evidence
              ↓
Timeline records lineage
              ↓
Memory preserves engineering knowledge
              ↓
Review / Integrate / Publish
              ↓
Deployment proceeds or is blocked
              ↓
Replay / Recovery / Restore
```

## Progress is first-class

Sessions continuously exposes proof that engineering work is moving forward through:

- Session activity;
- actor contribution history;
- Workstream progress;
- Checkpoints;
- semantic change summaries;
- verification progress;
- milestones;
- review status;
- release status;
- deployment and recovery history.

Full execution truth is preserved internally while useful product history remains easy to understand.

## Core engines

### Native Repository Engine

Owns repository identity, source objects, Workstreams, Checkpoint graph, change detection, state reconstruction, integration, publication, local operation, and synchronization.

### CodeVault

Owns immutable content-addressed state, integrity hashes, Checkpoint material, reconstruction inputs, and recovery targets.

### Semantic Engine

Understands affected components, dependencies, architectural intent, behavioral impact, introduced risk, semantic relationships, and meaningful change beyond line differences.

### Verification Engine

Coordinates linting, type checks, tests, builds, security checks, policy checks, approvals, trust evidence, release gates, and recovery confidence.

### Timeline Engine

Builds chronological attributable history across humans, AI systems, AI agents, services, tools, commands, changes, Checkpoints, verification, reviews, deployments, failures, and recovery.

### Memory Graph

Preserves durable engineering knowledge, architecture decisions, repository conventions, failure history, successful repairs, and semantic relationships.

### Execution Runtime

Tracks and governs humans, AI systems, AI agents, services, model use, tool access, generated changes, task boundaries, approvals, authority, and operational outcomes.

### Collaboration Platform

Owns organizations, teams, permissions, Work Items, Change Reviews, activity, search, notifications, packages, releases, dashboards, audit, hosted repositories, and developer identity.

### Deployment Runtime

Connects verified Checkpoints to environments, releases, deployments, health checks, recovery targets, and post-deployment evidence.

## Product surfaces

Sessions is one platform with many surfaces sharing one identity model, event model, repository model, authorization model, and execution graph:

- Web application
- VS Code extension
- Desktop application
- Mobile application
- CLI
- API
- SDK
- MCP server

See [docs/SURFACES.md](./docs/SURFACES.md).

## Developer-experience doctrine

Sessions should never make developers perform bookkeeping that Sessions can reliably infer itself.

The platform should automatically capture known context such as repository, Workstream, actors, changed files, execution events, verification evidence, Checkpoint relationships, and deployment state.

The default experience is simple. Deep implementation detail remains available through progressive disclosure.

## Reliability doctrine

Every critical subsystem is designed around:

- idempotency;
- retryability;
- rollback and restore;
- replayability;
- auditability;
- observability;
- failure isolation;
- immutable critical history;
- integrity verification.

Sessions never treats generated output as trusted merely because an AI produced it.

See [RELIABILITY.md](./RELIABILITY.md).

## Repository implementation

The `launch/sessions-production` branch contains the active implementation foundation including:

- human, AI-system, AI-agent, and service identities;
- attributable event contracts;
- CodeVault snapshots;
- Timeline recording and replay;
- verification evidence;
- web UI;
- CLI;
- API;
- runner;
- SDK;
- MCP server;
- VS Code extension;
- desktop application;
- mobile application;
- Docker production stack;
- PostgreSQL persistence.

The next major implementation layer is the Sessions-native repository engine: source-object storage, Workstreams, Checkpoint graph, change detection, native integration, publication, local repository format, synchronization, and hosted collaboration.

## Engineering stack

Current/target platform stack includes:

- TypeScript and Node.js;
- Next.js for web surfaces;
- PostgreSQL;
- Redis;
- S3-compatible object storage;
- Docker-isolated runners;
- OpenTelemetry-compatible telemetry;
- provider abstraction for AI systems;
- pnpm workspace organization.

## Security and governance

- Workspace-scoped permissions
- Human, AI-system, AI-agent, and service identity
- Capability-scoped authority
- Tool authorization
- Approval gates
- Sandboxed execution
- Secret protection
- Immutable evidence
- Integrity hashing
- Tenant boundaries
- Idempotent consequential operations
- Deployment and restore controls
- Complete execution auditability

## Product rule

**Preserve the capabilities developers need. Redesign unnecessary friction.**

Sessions is intended to stand on its own as a complete development platform.

## Documentation

- [ROADMAP.md](./ROADMAP.md) — implementation and launch sequence
- [ARCHITECTURE.md](./ARCHITECTURE.md) — platform architecture
- [RELIABILITY.md](./RELIABILITY.md) — reliability doctrine
- [docs/SURFACES.md](./docs/SURFACES.md) — product surfaces

## Ownership

Sessions is independently designed and developed by **Charles Castillo**.

All rights reserved. Commercial licensing and deployment inquiries are handled directly by the owner.
