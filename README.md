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
+ verification evidence
+ execution lineage
+ recovery and continuation
= Sessions
```

The UI should use familiar repository information architecture and interaction patterns without copying third-party branding or protected visual assets. Common workflows should require the same or fewer steps than their Git/GitHub equivalents, while Sessions-specific intelligence is revealed progressively.

## The developer promise

The first product experience should answer, in seconds:

1. What repository am I in?
2. What branch am I on?
3. What changed?
4. What commits exist?
5. What pull requests or issues need attention?
6. Who or what made each change?
7. Why was the change made?
8. What checks passed or failed?
9. What state is safe?
10. Can I recover and continue the work?

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

### Verification

Verification attaches durable evidence to commits, pull requests, releases, deployments, and Sessions rather than treating a change as trustworthy merely because it exists.

### Recovery and Continuation

Sessions preserves enough source state, context, execution history, evidence, and provenance to reconstruct interrupted work and continue it safely.

### AI Activity and Provenance

Human and AI actions are attributable. Sessions records who or what acted, what was executed, what changed, and what evidence supports the resulting state.

## Core execution loop

```text
Intent
  ↓
Branch
  ↓
Session
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
Recovery / Continuation
```

## Core engines

Sessions owns its own repository engine, immutable content storage, semantic engine, verification engine, chronological activity/history engine, memory graph, execution runtime, collaboration platform, and deployment runtime. Familiar terminology is a user-experience contract, not a dependency on GitHub's implementation.

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

Sessions should never make developers perform bookkeeping it can reliably infer itself. Repository, branch, actors, changed files, execution events, verification evidence, commit relationships, deployment state, and recovery information should be captured automatically where possible.

The default experience remains familiar and simple. Sessions-specific depth appears through progressive disclosure.

## Reliability doctrine

Critical subsystems are designed around idempotency, retryability, rollback/restore, replayability, auditability, observability, failure isolation, immutable critical history, and integrity verification.

Sessions never treats generated output as trusted merely because an AI produced it.

## Repository implementation

The `launch/sessions-production` branch contains the active implementation foundation including human/AI/service identities, attributable events, immutable source snapshots, activity/history recording and replay, verification evidence, web UI, CLI, API, runner, SDK, MCP server, VS Code extension, desktop/mobile surfaces, Docker production infrastructure, PostgreSQL persistence, billing, tenancy, recovery qualification, and production controls.

The product vocabulary rule applies across every surface. Existing internal Workstream/Checkpoint APIs can remain compatible while user-facing labels and new commands use Branch/Commit terminology.

## Engineering stack

Current/target platform stack includes TypeScript and Node.js, Next.js, PostgreSQL, Redis, S3-compatible object storage, Docker-isolated runners, OpenTelemetry-compatible telemetry, provider abstraction for AI systems, and pnpm workspaces.

## Security and governance

Sessions includes workspace-scoped permissions, human/AI/service identity, capability-scoped authority, tool authorization, approval gates, sandboxed execution, secret protection, immutable evidence, integrity hashing, tenant boundaries, idempotent consequential operations, deployment/restore controls, and execution auditability.

## UX acceptance standard

Before commercial release, the primary web, CLI, VS Code, desktop, mobile, documentation, onboarding, and help surfaces must be audited for terminology. Direct Git/GitHub equivalents should not be exposed under an unfamiliar Sessions-only name unless there is a demonstrated product reason.

The initial release optimizes for familiarity first. Terminology can evolve later using measured user behavior rather than forcing migration-time retraining.

## Documentation

- [ROADMAP.md](./ROADMAP.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [RELIABILITY.md](./RELIABILITY.md)
- [docs/SURFACES.md](./docs/SURFACES.md)

## Ownership

Sessions is independently designed and developed by **Charles Castillo**.

All rights reserved. Commercial licensing and deployment inquiries are handled directly by the owner.
