# Sessions Roadmap

## North Star

Sessions is AI-native source control and execution infrastructure for **AI systems, AI agents, and humans**.

Every milestone must improve at least one of: understanding, verification, reliability, recoverability, replayability, performance, or observability.

## Canonical success loop

```text
Human / AI System / AI Agent Goal
    → Collaborative Execution
    → Sessions captures execution
    → CodeVault preserves state
    → Verification validates
    → Timeline records lineage
    → Memory persists knowledge
    → Deployment proceeds or is blocked
    → Replay / Recovery / Rollback
```

## Milestone 0 — Foundation

Deliverables:

- TypeScript workspace
- shared actor and event contracts
- CodeVault snapshot primitives
- timeline recording primitives
- verification result model
- configuration and build scripts
- CI-ready project structure
- documentation source of truth

Exit criteria:

- the core packages compile;
- actor provenance distinguishes humans, AI agents, AI systems, and services;
- snapshots are content-addressed;
- timeline events are append-oriented and attributable.

## Milestone 1 — First real Session

Deliverables:

- Session lifecycle
- objective recording
- repository baseline
- actor identities
- prompt/model metadata
- command/tool events
- file-change events
- chronological timeline

Exit criteria:

A human, AI agent, or AI system can start a Session, perform work, and inspect an attributable execution history.

## Milestone 2 — CodeVault

Deliverables:

- immutable snapshot manifests
- SHA-256 integrity
- checkpoint creation
- snapshot object storage adapter
- repository state reconstruction
- rollback targets
- restoration verification

Exit criteria:

Sessions can restore a known repository state and verify that the restored content matches the recorded snapshot.

## Milestone 3 — Verification

Deliverables:

- configurable verification commands
- lint adapter
- type-check adapter
- test adapter
- build adapter
- security-hook interface
- verification evidence
- release gates
- rollback-confidence evidence

Exit criteria:

Sessions can explain why an execution state is accepted, rejected, or requires human review.

## Milestone 4 — Timeline + Replay

Deliverables:

- persisted event stream
- event ordering
- session reconstruction
- replay planner
- replay result evidence
- timeline UI/API
- failure navigation

Exit criteria:

A developer can answer: "How did this system reach its current state?"

## Milestone 5 — Semantic Engine

Deliverables:

- repository indexing
- component discovery
- dependency graph
- semantic change summaries
- affected-area analysis
- architecture relationships
- risk signals

Exit criteria:

Sessions explains the system-level significance of a change rather than only listing changed files.

## Milestone 6 — Memory Graph

Deliverables:

- architecture decisions
- repository conventions
- known failures
- successful fixes
- semantic relationships
- retrieval into later Sessions
- memory provenance and confidence

Exit criteria:

Relevant engineering knowledge survives beyond an individual conversation or execution.

## Milestone 7 — Execution Runtime

Deliverables:

- AI-system execution identity
- AI-agent execution identity
- human execution identity
- model/provider abstraction
- tool authorization
- sandbox command execution
- multi-actor workflows
- approval gates
- execution budgets and cancellation

Exit criteria:

Mixed human/AI workflows are first-class and fully attributable.

## Milestone 8 — Deployment Runtime

Deliverables:

- environments
- preview deployment hooks
- deployment events
- health checks
- release evidence
- rollback deploys
- post-deployment verification

Exit criteria:

Sessions connects execution history to deployed state and can recover from a failed release.

## Milestone 9 — Hosted Commercial Beta

Deliverables:

- authentication
- organizations/workspaces
- teams
- RBAC
- API keys
- GitHub App integration
- hosted persistence
- usage metering
- billing
- onboarding
- quotas and rate limits
- backups
- operational dashboards

Exit criteria:

External users can sign up, connect a repository, create Sessions, inspect execution history, verify work, and pay for hosted service.

## Milestone 10 — Scale and Enterprise

Deliverables:

- enterprise SSO
- policy controls
- audit export
- retention controls
- private runners
- organization-wide memory
- advanced verification
- compliance evidence
- multi-region architecture where justified by load

## CLI progression

Initial:

```bash
sessions init
sessions import
sessions start
sessions checkpoint
sessions verify
sessions timeline
sessions replay
sessions rollback
```

Later:

```bash
sessions deploy
sessions memory
sessions agents
sessions systems
```

## Launch demo

```text
Human/AI workflow receives task
    → modifies repository
    → subtle regression introduced
    → Sessions captures execution
    → Verification detects regression
    → Timeline shows causal sequence
    → replay reconstructs execution
    → rollback restores stable state
```

## Distribution

Launch channels include developer communities, GitHub, Product Hunt, Hacker News, Reddit, X, YouTube, and AI-coding communities. Content should demonstrate failure → understanding → recovery rather than generic feature announcements.

## Open-core boundary

Open:

- CLI
- local event capture
- actor/event specification
- snapshot fundamentals
- basic verification adapters
- SDK/integration contracts

Commercial:

- hosted collaboration
- enterprise governance
- advanced semantic intelligence
- organizational memory
- hosted runners
- deployment infrastructure
- large-scale orchestration
- advanced audit/compliance capabilities
