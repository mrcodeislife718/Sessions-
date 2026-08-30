import assert from "node:assert/strict";
import test from "node:test";
import { createSessionEvent, type ActorIdentity } from "@sessions/shared";
import { InMemoryMemoryStore, invalidateMemory, promoteMemory, queryMemory } from "./index.js";

const actor: ActorIdentity = { id: "human_test", kind: "human", displayName: "Test Human" };
const event = createSessionEvent({
  id: "event_decision",
  type: "DecisionMade",
  occurredAt: "2026-08-30T10:00:00Z",
  workspaceId: "workspace_test",
  projectId: "project_test",
  repositoryId: "repository_test",
  sessionId: "session_test",
  actor,
  payload: { decisionId: "decision_test", summary: "Use durable causal state" },
});

test("memory requires provenance and supports confidence-aware retrieval", async () => {
  const store = new InMemoryMemoryStore();
  await assert.rejects(() => promoteMemory(store, {
    id: "memory_invalid", workspaceId: "workspace_test", repositoryId: "repository_test", kind: "decision", subject: "causality", summary: "missing provenance", confidence: 0.9, provenanceEvents: [],
  }), /requires provenance/);

  await promoteMemory(store, {
    id: "memory_1", workspaceId: "workspace_test", repositoryId: "repository_test", sessionId: "session_test", kind: "decision", subject: "Causal persistence", summary: "Persist causal engineering state", confidence: 0.95, provenanceEvents: [event], evidenceIds: ["evidence_1"], occurredAt: "2026-08-30T10:01:00Z",
  });
  const result = await queryMemory(store, "repository_test", { subject: "causal", minimumConfidence: 0.9 });
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].provenanceEventIds, ["event_decision"]);
});

test("memory supersession and invalidation preserve lifecycle truth", async () => {
  const store = new InMemoryMemoryStore();
  await promoteMemory(store, { id: "memory_old", workspaceId: "workspace_test", repositoryId: "repository_test", kind: "architecture", subject: "timeline", summary: "Old architecture", confidence: 0.7, provenanceEvents: [event], occurredAt: "2026-08-30T10:01:00Z" });
  await promoteMemory(store, { id: "memory_new", workspaceId: "workspace_test", repositoryId: "repository_test", kind: "architecture", subject: "timeline", summary: "Durable architecture", confidence: 0.98, provenanceEvents: [event], supersedesMemoryId: "memory_old", occurredAt: "2026-08-30T10:02:00Z" });
  assert.equal((await store.get("memory_old"))?.status, "superseded");
  await invalidateMemory(store, "memory_new", "2026-08-30T10:03:00Z");
  assert.equal((await store.get("memory_new"))?.status, "invalidated");
  assert.equal((await queryMemory(store, "repository_test")).length, 0);
});
