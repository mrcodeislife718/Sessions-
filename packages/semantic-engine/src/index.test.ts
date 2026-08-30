import assert from "node:assert/strict";
import test from "node:test";
import { InMemorySemanticStore, deriveCausalSemanticRelationships, neighbors, recordRelationship, type SemanticSourceEvent } from "./index.js";

const common = { workspaceId: "workspace_test", repositoryId: "repository_test" };
const decision: SemanticSourceEvent = { ...common, id: "decision_event", type: "DecisionMade", occurredAt: "2026-08-30T10:00:00Z" };
const change: SemanticSourceEvent = { ...common, id: "change_event", type: "FileChanged", causationId: decision.id, occurredAt: "2026-08-30T10:01:00Z" };
const verified: SemanticSourceEvent = { ...common, id: "verify_event", type: "VerificationPassed", causationId: change.id, occurredAt: "2026-08-30T10:02:00Z" };

test("semantic relationships require evidence", async () => {
  const store = new InMemorySemanticStore();
  await assert.rejects(() => recordRelationship(store, {
    id: "edge_invalid", workspaceId: "workspace_test", repositoryId: "repository_test", sourceKind: "decision", sourceId: "a", relationship: "caused", targetKind: "file", targetId: "b", confidence: 1, evidenceEvents: [], analyzerVersion: "test-v1",
  }), /require evidence/);
});

test("causal event lineage derives evidence-linked semantic edges", async () => {
  const store = new InMemorySemanticStore();
  const edges = await deriveCausalSemanticRelationships(store, [decision, change, verified], "test-v1");
  assert.equal(edges.length, 2);
  assert.equal(edges[0].sourceKind, "decision");
  assert.equal(edges[0].targetKind, "file");
  assert.deepEqual(edges[0].evidenceEventIds, ["decision_event", "change_event"]);
  const incoming = await neighbors(store, "repository_test", { kind: "verification", id: "verify_event" }, { direction: "incoming", minimumConfidence: 1 });
  assert.equal(incoming.length, 1);
  assert.equal(incoming[0].sourceId, "change_event");
});
