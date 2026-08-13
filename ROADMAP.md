# Sessions Roadmap

## North Star

Sessions is a native software development platform for **AI systems, AI agents, and humans**.

It owns three first-class layers:

1. **Source Control** — repositories, Workstreams, Checkpoints, history, diffs, integration, restore, publication, local/offline operation, content integrity, and synchronization.
2. **Collaboration** — organizations, teams, permissions, Work Items, Change Reviews, approvals, activity, search, notifications, verification, runners, releases, deployments, APIs, webhooks, packages/artifacts, dashboards, audit, and developer identity.
3. **Intelligence** — execution lineage, objectives, intent, semantic state, verification lineage, engineering memory, causal timeline, replay, recovery, trust evidence, and semantic rollback.

Every milestone must improve at least one of: developer simplicity, understanding, verification, reliability, recoverability, replayability, collaboration, performance, or observability.

## Canonical development model

```text
Goal
  → Workstream
  → Session
  → Checkpoint
  → Verify
  → Review
  → Integrate
  → Publish
  → Release
  → Deploy
  → Replay / Recover / Restore
```

## Milestone 0 — Foundation

Deliverables:

- TypeScript workspace
- actor and event contracts
- CodeVault snapshot primitives
- timeline recording primitives
- verification result model
- API and persistence foundation
- Docker runtime
- CLI, web, editor, desktop, mobile, SDK, and MCP surfaces
- documentation source of truth

Exit criteria:

- core packages compile;
- actor provenance distinguishes humans, AI agents, AI systems, and services;
- snapshots are content-addressed;
- timeline events are append-oriented and attributable;
- product surfaces consume one platform contract.

## Milestone 1 — Sessions-Native Repository Engine

Deliverables:

- repository object model
- local repository format under `.sessions/`
- content-addressed source object store
- repository manifest
- file-state scanner
- change detection
- Workstream model
- Checkpoint graph
- friendly Checkpoint names plus immutable IDs
- local history
- repository status
- ignore rules
- repository integrity verification

Exit criteria:

A developer can initialize a Sessions repository, modify files, inspect changes, create native Checkpoints, and browse history without another source-control system.

## Milestone 2 — Native Checkpoints + History

Deliverables:

- automatic change grouping
- Checkpoint creation
- parent relationships
- semantic metadata
- actor attribution
- objective linkage
- verification attachment
- Checkpoint lifecycle: Draft → Verified → Reviewed → Approved → Published
- restore targets
- product-history views
- full execution-history preservation

Exit criteria:

Sessions preserves full execution truth while presenting clean, meaningful development history.

## Milestone 3 — Workstreams

Deliverables:

- create/switch/list Workstreams
- objective-bound work
- independent state heads
- Workstream progress
- actor participation
- overlapping-work detection
- Workstream comparison
- local Workstream synchronization model

Exit criteria:

Developers can isolate and coordinate parallel work without managing low-level source-control mechanics as the primary workflow.

## Milestone 4 — Native Diff + Semantic Change

Deliverables:

- file additions/removals/modifications
- text and binary change metadata
- raw source difference viewer
- semantic change summaries
- affected components
- dependency impact
- risk indicators
- source/semantic comparison between Checkpoints and Workstreams

Exit criteria:

Developers can understand both exactly what changed and what the change means to the system.

## Milestone 5 — Native Integration

Deliverables:

- integrate Workstream into target
- source conflict detection
- semantic conflict detection
- verification prerequisites
- overlapping-work analysis
- policy checks
- recovery readiness
- integration preview
- atomic integration record

Exit criteria:

Sessions can combine independent work safely while explaining conflicts before asking a developer to resolve them.

## Milestone 6 — Publish + Distributed Synchronization

Deliverables:

- local identity
- hosted repository identity
- publish protocol
- pull/sync protocol
- object negotiation
- missing-object transfer
- Checkpoint graph synchronization
- concurrent update detection
- resumable transfer
- integrity verification
- offline-first reconciliation

Exit criteria:

Two Sessions installations can exchange repository state and history reliably without shared local storage.

## Milestone 7 — Hosted Collaboration Platform

Deliverables:

- authentication
- organizations
- teams
- RBAC and capability-scoped authority
- hosted repositories
- Work Items
- Change Reviews
- approvals
- activity feed
- notifications
- search
- audit history
- developer, AI-system, and AI-agent identities

Exit criteria:

A team can build and collaborate entirely within Sessions.

## Milestone 8 — Verification Platform

Deliverables:

- configurable verification commands
- lint adapter
- type-check adapter
- test adapter
- build adapter
- security checks
- policy gates
- verification evidence
- release gates
- recovery-confidence evidence
- verification progress UI

Exit criteria:

Sessions can explain why a Checkpoint or integrated state is accepted, rejected, or requires review.

## Milestone 9 — Timeline + Replay

Deliverables:

- persisted event stream
- actor contribution history
- event ordering
- Session reconstruction
- replay planner
- replay result evidence
- timeline UI/API
- failure navigation
- progress milestones

Exit criteria:

A developer can answer: "How did this system reach its current state?"

## Milestone 10 — Semantic Engine + Memory

Deliverables:

- repository indexing
- component discovery
- dependency graph
- architecture relationships
- semantic change summaries
- risk signals
- architecture decisions
- repository conventions
- known failures
- successful fixes
- memory provenance and confidence

Exit criteria:

Sessions understands development history as engineering knowledge, not only file history.

## Milestone 11 — Execution Runtime

Deliverables:

- human execution identity
- AI-system execution identity
- AI-agent execution identity
- model/provider abstraction
- tool authorization
- capability-scoped permissions
- sandbox execution
- multi-actor workflows
- approval gates
- execution budgets and cancellation

Exit criteria:

Mixed human/AI development is first-class, attributable, governed, and recoverable.

## Milestone 12 — Releases + Deployment

Deliverables:

- releases
- packages/artifacts
- environments
- preview deployment
- deployment events
- health checks
- release evidence
- restore deploys
- post-deployment verification

Exit criteria:

Sessions connects development state to deployed state and can safely recover from failed releases.

## Milestone 13 — Commercial Beta

Deliverables:

- billing
- usage metering
- quotas
- rate limits
- backups
- onboarding
- operational dashboards
- account administration
- hosted runners
- production support workflow

Exit criteria:

External users can create native Sessions repositories, collaborate, verify, publish, deploy, recover, and pay for the service.

## Milestone 14 — Scale and Enterprise

Deliverables:

- enterprise SSO
- advanced policy controls
- audit export
- retention controls
- private runners
- organization-wide memory
- advanced verification
- compliance evidence
- horizontal scaling
- multi-region architecture only where real load requires it

## CLI direction

Canonical native commands:

```bash
sessions init
sessions status
sessions workstream create
sessions workstream switch
sessions checkpoint
sessions history
sessions diff
sessions verify
sessions review
sessions integrate
sessions publish
sessions sync
sessions timeline
sessions replay
sessions restore
sessions release
sessions deploy
```

The CLI should avoid exposing low-level bookkeeping when Sessions can infer it safely.

## Launch acceptance test

A developer can:

```text
Install Sessions
  → initialize a native repository
  → create a Workstream
  → make changes
  → watch progress/activity
  → create a Checkpoint
  → verify it
  → review it
  → integrate it
  → publish it
  → collaborate with another user
  → release/deploy it
  → replay its history
  → restore a known-good state
```

No external source-control or collaboration platform is required.

## Product rule

**Preserve the capabilities developers need. Redesign unnecessary friction.**
