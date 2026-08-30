# Sessions

**Git-familiar software development infrastructure for AI systems, AI agents, and humans.**

Sessions is an independent source-control, collaboration, execution, verification, recovery, and deployment platform designed for modern software development.

## Product rule: familiar names first

Sessions competes with Git and GitHub. The initial product therefore uses the terminology developers already know whenever Sessions has a direct equivalent.

**Same concept → same familiar name. New capability → Sessions-specific name. Better technology → underneath the familiar interface.**

The default user-facing vocabulary is:

- Repository
- Branch
- Commit
- Pull request
- Issue
- Code
- Actions
- Projects
- Security
- Insights
- Settings
- Releases
- Tags
- Contributors
- History
- Blame
- Fork
- Clone
- Merge
- Compare
- Discussions

Sessions-specific names are reserved for capabilities Git/GitHub do not directly provide, including Sessions, persistent context, Intent, Evidence, Verification, Recovery, Continuation, Execution Lineage, AI Activity, and human/AI provenance.

Internal implementation objects may retain native names such as Workstream or Checkpoint while the initial user interface presents their familiar equivalents, Branch and Commit. This lets Sessions improve the underlying model without forcing developers to relearn source control.

## Product mission

Make software development simpler, more understandable, more verifiable, more recoverable, and more collaborative for humans and AI while preserving Git/GitHub developer muscle memory.

## Competitive standard

Sessions must be familiar enough that a Git/GitHub user can begin using it with minimal retraining, while being measurably better at preserving development context, explaining changes, attributing human and AI work, verifying outcomes, recovering interrupted work, and continuing engineering objectives.

```text
Git/GitHub familiarity
+ persistent engineering context
+ human/AI provenance
+ causal decision lineage
+ verification evidence
+ execution lineage
+ recovery and continuation
= Sessions
```

Material architecture work follows the repository's Architecture Enhancement Standard: analyze the strongest alternatives before coding, preserve or exceed their strengths, structurally eliminate weaknesses where practical, define evidence and benchmarks for each innovation, and analyze behavior at 1x, 10x, and 100x including success-too-well failures.

## The developer promise

The first product experience should answer, in seconds:

1. What repository am I in?
2. What branch am I on?
3. What changed?
4. What commits exist?
5. What pull requests or issues need attention?
6. Who or what made each change?
7. Why was the change made?
8. What caused this state and what did it cause downstream?
9. What checks passed or failed?
10. What state is safe?
11. Can I recover and continue the work?

## Familiar surface, stronger system

| Familiar concept | Sessions implementation advantage |
| --- | --- |
| Repository | Source + persistent engineering context + execution lineage |
| Branch | Purpose-aware parallel development with objective context |
| Commit | Immutable source state plus intent, actors, verification and recovery metadata |
| Pull request | Change review plus semantic impact, evidence, AI/human provenance and recovery readiness |
| Actions | Execution lineage, verification evidence and reproducibility |
| History | Chronological human + AI engineering history |
| Blame | Human/AI contribution provenance |
| Merge | Integration with semantic conflicts, verification and rollback readiness |
| Release | Verified state connected to deployment and recovery evidence |
| Restore | Integrity-checked recovery that preserves interrupted work |

## Sessions-specific capabilities

### Session

A Session records the attributable execution story of work performed by humans, AI systems, AI agents, and services. Sessions survive chat boundaries, agent changes, machine changes, and interrupted work.

### Causal Reasoning Graph

Sessions treats engineering decisions and causal relationships as first-class development data rather than burying them in chat logs. Decision proposals, decisions, rejected decisions, alternatives, assumptions, evidence references, supersession, execution, source changes, checkpoints, verification, deployments and outcomes can form a durable causal lineage.

The hosted API and CLI support upstream and downstream traversal by event ID or known engineering object ID:

```bash
sessions why <event-or-object-id>
sessions causes <event-or-object-id>
sessions consequences <event-or-object-id>
sessions lineage <event-or-object-id>
```

Causal writes reject missing parents and cross-Session ancestry. Checkpoint and verification events are persisted transactionally with their engineering artifacts. Causal edges are also materialized into semantic relationships, while qualified decisions, assumptions, failures and outcomes can be promoted into provenance-bearing engineering memory.

### Verification

Verification attaches durable evidence to commits, pull requests, releases, deployments, and Sessions rather than treating a change as trustworthy merely because it exists.

### Recovery and Continuation

Sessions preserves enough source state, context, execution history, evidence, provenance and causal lineage to reconstruct interrupted work and continue it safely.

### AI Activity and Provenance

Human and AI actions are attributable. Sessions records who or what acted, what was executed, what changed, what caused it, and what evidence supports the resulting state.

## Core execution loop

```text
Intent
  ↓
Branch
  ↓
Session
  ↓
Decision / Assumption / Evidence
  ↓
Execution
  ↓
Commit
  ↓
Actions / Checks
  ↓
Pull request
  ↓
Merge
  ↓
Release
  ↓
Deploy
  ↓
Outcome / Recovery / Continuation
```

## Core engines

Sessions owns its own repository engine, immutable content storage, semantic engine, verification engine, chronological activity/history engine, memory graph, execution runtime, collaboration platform, and deployment runtime. Familiar terminology is a user-experience contract, not a dependency on GitHub's implementation.

The causal Timeline Engine has both in-memory qualification storage and durable PostgreSQL storage. The Memory Graph supports provenance, confidence, supersession and invalidation. The Semantic Engine stores evidence-linked, analyzer-versioned relationships and can derive semantic causal edges from Session history.

## Product surfaces

- Web application
- VS Code extension
- Desktop application
- Mobile application
- CLI
- API
- SDK
- MCP server

## Developer-experience doctrine

Sessions should never make developers perform bookkeeping it can reliably infer itself. Repository, branch, actors, changed files, execution events, causal relationships, verification evidence, commit relationships, deployment state, and recovery information should be captured automatically where possible.

The default experience remains familiar and simple. Sessions-specific depth appears through progressive disclosure.

## Reliability doctrine

Critical subsystems are designed around idempotency, retryability, rollback/restore, replayability, auditability, observability, failure isolation, immutable critical history, causal integrity, and integrity verification.

Sessions never treats generated output as trusted merely because an AI produced it. Persisted memory and semantic relationships retain provenance and confidence rather than becoming authority automatically.

## Repository implementation

`main` is the current canonical integration line. It contains the Sessions-native repository foundation, human/AI/service identities, durable attributable events, causal reasoning traversal, immutable source snapshots, semantic relationships, engineering memory, activity/history recording and replay, verification evidence, web UI, CLI, API, runner, SDK, MCP server, VS Code extension, desktop/mobile surfaces, Docker production infrastructure, PostgreSQL persistence, billing, tenancy, recovery qualification, and production controls.

The product vocabulary rule applies across every surface. Existing internal Workstream/Checkpoint APIs can remain compatible while user-facing labels and new commands use Branch/Commit terminology.

## Engineering stack

Current/target platform stack includes TypeScript and Node.js, Next.js, PostgreSQL, Redis, S3-compatible object storage, Docker-isolated runners, OpenTelemetry-compatible telemetry, provider abstraction for AI systems, and pnpm workspaces.

## Security and governance

Sessions includes workspace-scoped permissions, human/AI/service identity, capability-scoped authority, tool authorization, approval gates, sandboxed execution, secret protection, immutable evidence, integrity hashing, tenant boundaries, idempotent consequential operations, deployment/restore controls, causal graph integrity and execution auditability.

## UX acceptance standard

Before commercial release, the primary web, CLI, VS Code, desktop, mobile, documentation, onboarding, and help surfaces must be audited for terminology. Direct Git/GitHub equivalents should not be exposed under an unfamiliar Sessions-only name unless there is a demonstrated product reason.

The initial release optimizes for familiarity first. Terminology can evolve later using measured user behavior rather than forcing migration-time retraining.

## Documentation

- [ROADMAP.md](./ROADMAP.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [RELIABILITY.md](./RELIABILITY.md)
- [Architecture Enhancement Standard](./docs/ARCHITECTURE_ENHANCEMENT_STANDARD.md)
- [Reasoning Graph Architecture](./docs/REASONING_GRAPH_ARCHITECTURE.md)
- [docs/SURFACES.md](./docs/SURFACES.md)

## Ownership

Sessions is independently designed and developed by **Charles Castillo**.

All rights reserved. Commercial licensing and deployment inquiries are handled directly by the owner.
