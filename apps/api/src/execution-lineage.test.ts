import test from "node:test";
import assert from "node:assert/strict";
import { classifyReplay, createExecutionEvent, createRuntimeFingerprint } from "@sessions/shared";

const actor = { id: "worker-1", kind: "ai_agent" as const, displayName: "Worker" };
const base = { workspaceId: "workspace-1", projectId: "project-1", repositoryId: "repo-1", sessionId: "session-1", actor };

test("execution lineage preserves durable worker and provider-session separation", () => {
  const assigned = createExecutionEvent({
    ...base,
    id: "event-worker",
    type: "WorkerAssigned",
    correlationId: "task-1",
    payload: { taskId: "task-1", logicalWorkerId: "worker-1", role: "builder" },
  });
  const qwen = createExecutionEvent({
    ...base,
    id: "event-qwen",
    type: "ProviderSessionBound",
    correlationId: "task-1",
    causationId: assigned.id,
    payload: { taskId: "task-1", logicalWorkerId: "worker-1", providerSessionId: "provider-qwen", provider: "qwen" },
  });
  const codex = createExecutionEvent({
    ...base,
    id: "event-codex",
    type: "ProviderSessionBound",
    correlationId: "task-1",
    causationId: qwen.id,
    payload: { taskId: "task-1", logicalWorkerId: "worker-1", providerSessionId: "provider-codex", provider: "codex" },
  });
  assert.equal(qwen.payload.logicalWorkerId, codex.payload.logicalWorkerId);
  assert.notEqual(qwen.payload.providerSessionId, codex.payload.providerSessionId);
});

test("runtime fingerprint captures execution conditions as lineage evidence", () => {
  const fingerprint = createRuntimeFingerprint({
    provider: "openai",
    model: "example-model",
    modelVersion: "2026-09",
    runtime: "node",
    runtimeVersion: "24",
    hardwareClass: "linux-x64",
    batchingMode: "dynamic",
    repositoryCommit: "abc123",
    toolVersions: { npm: "11", node: "24" },
    inputDigests: ["input-b", "input-a"],
  });
  const event = createExecutionEvent({
    ...base,
    id: "event-runtime",
    type: "ExecutionEnvironmentCaptured",
    correlationId: "task-1",
    payload: { taskId: "task-1", runtimeFingerprint: fingerprint },
  });
  assert.match(event.payload.runtimeFingerprint?.digest ?? "", /^[a-f0-9]{64}$/);
});

test("replay classification explains divergent runtime conditions", () => {
  const a = createRuntimeFingerprint({ model: "example-model", batchingMode: "fixed", repositoryCommit: "abc123" });
  const b = createRuntimeFingerprint({ model: "example-model", batchingMode: "dynamic", repositoryCommit: "abc123" });
  const result = classifyReplay({ outputDigestA: "out-a", outputDigestB: "out-b", runtimeA: a, runtimeB: b });
  assert.equal(result.classification, "material_divergence");
  assert.deepEqual(result.runtimeDifferences, ["batchingMode"]);
});

test("qualified completion requires evidence", () => {
  assert.throws(() => createExecutionEvent({
    ...base,
    id: "event-complete",
    type: "TaskCompleted",
    payload: { taskId: "task-1", outcome: "success" },
  }), /requires evidenceIds/);
});

test("authority and causal execution identifiers are validated", () => {
  assert.throws(() => createExecutionEvent({
    ...base,
    id: "event-authority",
    type: "AuthorityEvaluated",
    payload: { taskId: "task-1" },
  }), /authorityDecision/);
  assert.throws(() => createExecutionEvent({
    ...base,
    id: "event-worktree",
    type: "WorktreeCreated",
    payload: { taskId: "task-1" },
  }), /worktree/);
  assert.throws(() => createExecutionEvent({
    ...base,
    id: "event-runtime-missing",
    type: "ExecutionEnvironmentCaptured",
    payload: { taskId: "task-1" },
  }), /runtimeFingerprint/);
});
