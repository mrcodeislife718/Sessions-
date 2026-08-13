# Sessions

**AI-native source control and execution infrastructure for AI systems, AI agents, and humans.**

Sessions is the operating environment for software systems built, modified, verified, deployed, and evolved collaboratively by humans and AI.

Traditional version control preserves file history. Sessions preserves the execution context around software change: who or what acted, what objective was being pursued, which repository state was received, which tools and commands were used, what changed, which verification evidence passed or failed, what was deployed, and how the resulting system can be replayed, reconstructed, recovered, or rolled back.

> Git and GitHub were created for a software-development world centered primarily around human developers and file-based version history. Sessions is designed for the emerging world where AI systems, AI agents, and humans build, modify, operate, verify, and evolve software together.

## The developer promise

Sessions should make a developer's life easier before it asks them to learn a new infrastructure model.

The product is designed to reduce four expensive kinds of engineering work:

- **reconstruction:** stop piecing together what happened from chat history, terminal scrollback, commits, CI logs, and memory;
- **review overhead:** focus attention on consequential, risky, or unverified changes instead of treating every generated line equally;
- **verification uncertainty:** keep test, build, security, policy, and approval evidence attached to the exact state that produced it;
- **recovery time:** move from a failure to a known-good checkpoint with replay and rollback context already available.

The first product experience should answer, in seconds:

1. What changed?
2. Who or what changed it?
3. Why did it change?
4. What was actually verified?
5. What failed?
6. Can I replay how we got here?
7. Can I roll back safely?

Sessions is not intended to create another dashboard developers must babysit. It should remove debugging archaeology, reduce context switching, and make human/AI software work easier to trust and recover.

## Product category

Sessions combines AI-native source control, execution lineage, software verification, engineering memory, deployment history, and operational observability in one platform.

Sessions is not infrastructure only for autonomous agents. A human engineer can create and operate a Session. An AI coding agent can create and operate within a Session. A larger AI system coordinating models, agents, tools, and humans can operate through Sessions. Mixed human/AI workflows are first-class.

## Core workflow

```text
Human / AI System / AI Agent Goal
              ↓
Collaborative Execution
              ↓
Sessions captures execution
              ↓
CodeVault preserves semantic state
              ↓
Verification validates the result
              ↓
Timeline records lineage
              ↓
Memory preserves engineering knowledge
              ↓
Deployment proceeds or is blocked
              ↓
Replay / Recovery / Rollback
```

## What Sessions adds beyond Git

Git primarily tracks files, commits, branches, merges, and authorship.

Sessions additionally tracks:

- human execution history;
- AI-agent execution history;
- AI-system execution history;
- human/AI collaboration;
- objectives and intent;
- semantic state;
- tool and command execution;
- verification lineage;
- engineering memory;
- execution provenance;
- deployment evolution;
- replay;
- recovery;
- rollback.

## Core platform primitives

`Organization → Workspace → Project → Repository → Branch → Session → Snapshot → Timeline → Verification → Memory → Actor → Deployment → Rollback`

Actors are explicitly typed as `human`, `ai_agent`, `ai_system`, or `service` so provenance never collapses different kinds of execution into one generic identity.

## Core platform

### CodeVault

CodeVault is the immutable state, snapshot, reconstruction, and recovery engine inside Sessions. It preserves content-addressed software state, execution lineage, semantic checkpoints, integrity records, and rollback targets.

### Semantic Engine

Understands changes at the system level: affected components, dependency relationships, architectural intent, behavioral impact, introduced risk, and the meaning of a change beyond its textual diff.

### Verification Engine

Coordinates linting, type checks, tests, security checks, policy checks, build validation, trust evidence, rollback analysis, and release evidence.

### Timeline Engine

Builds a chronological execution graph across human actions, AI-system activity, agent activity, prompts, tool calls, commands, file changes, validation events, deployments, failures, approvals, and recovery actions.

### Memory Graph

Preserves engineering knowledge across sessions, including architectural decisions, repository conventions, failure history, successful repairs, semantic relationships, and system evolution.

### Execution Runtime

Tracks and governs execution by AI systems, AI agents, humans, and supporting services, including model use, tool access, generated changes, task boundaries, approvals, and operational outcomes.

### Deployment Runtime

Connects verified repository state to preview environments, releases, deployment records, health checks, rollback operations, and post-deployment evidence.

### Observability Layer

Provides logs, metrics, traces, health information, token and model usage, cost records, execution status, and operational diagnostics.

## Mixed workflow example

```text
Human starts Session
    ↓
AI system plans work
    ↓
Agent A investigates
    ↓
Human changes architecture
    ↓
Agent B implements
    ↓
Verification runs
    ↓
Human approves
    ↓
AI system deploys
    ↓
Sessions preserves the entire lineage
```

Every consequential action emits a durable event. Critical history is append-only, integrity-protected, attributable to an actor, and reconstructable.

## Reliability doctrine

Every critical subsystem is designed around:

- idempotency;
- retryability;
- rollback;
- replayability;
- auditability;
- observability;
- failure isolation;
- immutable critical history.

Sessions never treats generated output as trusted merely because an AI produced it. Consequential output must be observable and capable of producing verification evidence.

See [RELIABILITY.md](./RELIABILITY.md).

## Repository implementation

The `launch/sessions-production` branch contains the open implementation foundation for the Sessions execution model and its developer-facing product surface, including typed actors, event contracts, CodeVault snapshot primitives, timeline recording, verification result contracts, a responsive Next.js application, and CI validation.

The current web surface includes:

- a developer-first product page;
- a workspace dashboard focused on active Sessions, verification, rollback readiness, and recovery;
- a Session detail surface combining participant provenance, execution timeline, semantic change summary, verification evidence, replay entry points, and rollback context.

The initial implementation is intentionally modular and TypeScript-first so the core execution model can be validated before heavier hosted infrastructure is added.

## Engineering stack

Target production stack:

- Next.js + TypeScript for product surfaces;
- Node.js/NestJS for hosted APIs;
- PostgreSQL + Prisma;
- Redis + BullMQ;
- S3-compatible object storage;
- Docker-isolated runners;
- OpenTelemetry-compatible telemetry;
- provider abstraction for OpenAI, Anthropic, local models, and future systems;
- pnpm + Turborepo-style workspace organization.

## Security and governance

- Workspace-scoped permissions
- Human, AI-system, AI-agent, and service identity
- Tool and capability authorization
- Approval gates for consequential actions
- Sandboxed command execution
- Secret and environment protection
- Immutable evidence and integrity hashing
- Tenant and project boundaries
- Idempotent consequential operations
- Deployment and rollback controls
- Complete execution and access auditability

## Adoption strategy

Sessions does not require teams to abandon Git. The initial wedge is to make AI-generated and human/AI collaborative software dramatically safer, easier to understand, and easier to recover while integrating with existing Git/GitHub workflows.

The north-star demonstration is simple:

```text
AI or human/AI workflow changes code
    → Sessions captures the execution
    → verification catches a regression
    → timeline identifies how it happened
    → replay reconstructs the path
    → rollback restores a stable state
```

The packaging rule is equally simple: lead with the developer outcome, then reveal the infrastructure beneath it.

**Stop guessing what changed. Know. Verify. Recover.**

## Open-core direction

Open-source surface:

- CLI;
- local execution capture;
- event model;
- snapshot fundamentals;
- basic verification adapters;
- SDK and integration contracts.

Commercial surface:

- hosted collaboration;
- organizational memory;
- enterprise governance and RBAC;
- advanced semantic intelligence;
- hosted runners;
- deployment infrastructure;
- large-scale orchestration;
- advanced verification and compliance tooling.

## Documentation

- [ROADMAP.md](./ROADMAP.md) — implementation and launch sequence
- [ARCHITECTURE.md](./ARCHITECTURE.md) — system boundaries and execution model
- [RELIABILITY.md](./RELIABILITY.md) — reliability doctrine and operational requirements

## GitHub integration

Sessions is intended to integrate with GitHub through a dedicated GitHub App for repository authorization, webhook ingestion, commit/PR association, validation evidence, and release visibility. Git integration is an adoption bridge and interoperability layer, not the limit of the Sessions execution model.

## Ownership

Sessions is independently designed and developed by **Charles Castillo**.

All rights reserved. Commercial licensing and deployment inquiries are handled directly by the owner.
