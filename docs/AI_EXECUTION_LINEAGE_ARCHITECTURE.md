# AI Execution Lineage Architecture

## Decision

Sessions should preserve the complete engineering story of autonomous and assisted software work, not merely record that files changed.

The core question Sessions must be able to answer is:

> Why does this code exist, who or what changed it, what objective caused the change, what authority allowed it, what evidence proved it, and what happened afterward?

## Required causal chain

A representative software-engineering lineage is:

```text
ObjectiveReceived
  -> PlanCreated
  -> TaskCreated
  -> WorkerAssigned
  -> AuthorityEvaluated
  -> WorktreeCreated
  -> FilesInspected
  -> PatchProposed
  -> PatchApproved
  -> FileChanged
  -> CommandExecuted
  -> TestExecuted
  -> VerificationPassed / VerificationFailed
  -> ReviewPassed / ReviewFailed
  -> CommitCreated
  -> CheckpointCreated
  -> TaskCompleted / TaskFailed / RolledBack
```

Not every execution requires every event, but consequential work should preserve enough of this chain to explain causation and verification.

## Event attribution

Material events should be able to carry or reference:

- repository;
- branch;
- worktree/workspace;
- Session;
- objective;
- task;
- actor;
- logical worker identity;
- provider/model session;
- role;
- causation ID;
- correlation ID;
- timestamp;
- tool;
- normalized operation or arguments;
- authority/policy decision;
- approval reference;
- before/after hashes;
- command result;
- verification evidence;
- checkpoint/rollback reference;
- downstream affected objects.

## Logical worker and provider distinction

Sessions should distinguish the durable worker that owns a task from the disposable provider session that happened to execute part of it.

Example:

```text
Worker: builder-17
Task: fix authentication callback

Execution segment 1: local Qwen
Execution segment 2: Codex
Execution segment 3: Claude
```

The engineering story remains one worker/task lineage even if providers switch because of failure, cost, capability, or operator choice.

## Authority as first-class history

Sessions should persist authority decisions when they materially affect execution.

Examples:

- allowed to read repository;
- allowed to modify files A and B only;
- denied network access;
- deployment required human approval;
- database migration rejected;
- secret access granted for one bounded operation.

This allows future investigation to distinguish what an agent was technically capable of doing from what it was actually authorized to do.

## Verification lineage

Verification must connect to the work it qualifies.

Sessions should preserve relationships such as:

```text
Requirement
  -> Task
  -> Source change
  -> Test
  -> Verification result
  -> Review
  -> Commit
  -> Deployment
  -> Observed outcome
```

A passing test without a causal connection to the requirement or source change is weaker evidence than a qualified verification chain.

## Repair and failure history

Failures should not disappear after a repair succeeds. Sessions should preserve:

- original failure;
- root-cause hypothesis;
- diagnostic evidence;
- repair plan;
- repair attempt;
- retry count;
- provider/model changes;
- verification result;
- rollback if required;
- final outcome.

This history becomes reusable engineering memory and supports later explanations of why unusual code or defensive behavior exists.

## Parallel-worker lineage

When multiple workers operate in separate worktrees or workspaces, Sessions should preserve ownership and integration relationships:

- which task created each worktree;
- which worker owned it;
- base revision;
- changes made there;
- conflicts encountered;
- integration/merge decision;
- verification before and after integration;
- cleanup or archival state.

## Cross-product integration

### Codeable

Codeable should emit objective, plan, task, worker assignment, authority, review, repair, and completion events.

### Dev-Zero

Dev-Zero should emit local execution facts: worktree/workspace lifecycle, commands, file operations, process results, verification, checkpoint, rollback, resource and policy failures.

### Axion

Sessions should be able to reference Axion identities and manifest versions for AI workers, runtimes, tools, and other registered systems involved in an execution.

## User-facing outcomes

The lineage should support questions such as:

- Why does this line/file/module exist?
- Which requirement caused it?
- Which AI or human changed it?
- Which model/provider actually executed the change?
- What was that worker allowed to do?
- Which tests prove the result?
- Did an earlier failure cause this repair?
- What downstream code or deployment depends on it?
- Can the change be replayed, reverted, or continued?

## Product invariant

Sessions must preserve the difference between:

- what was intended;
- what was authorized;
- what was attempted;
- what actually happened;
- what was verified;
- what ultimately resulted.

That separation is required for trustworthy human/AI engineering history.