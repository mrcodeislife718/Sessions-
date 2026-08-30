import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryTimelineStore, CausalIntegrityError, causes, consequences, why } from "./index.js";
import { createSessionEvent, type ActorIdentity } from "@sessions/shared";

const actor: ActorIdentity = { id: "human_test", kind: "human", displayName: "Test Human" };
const base = { workspaceId: "workspace_test", projectId: "project_test", repositoryId: "repository_test", sessionId: "session_test", actor };

function event(id: string, type: Parameters<typeof createSessionEvent>[0]["type"], causationId?: string) {
  return createSessionEvent({ ...base, id, type, causationId, occurredAt: `2026-08-30T10:00:0${id.at(-1) ?? "0"}Z`, payload: { id } });
}

test("causal graph returns reasons and consequences", async () => {
  const store = new InMemoryTimelineStore();
  await store.append(event("e1", "SessionStarted"));
  await store.append(event("e2", "DecisionMade", "e1"));
  await store.append(event("e3", "AgentExecuted", "e2"));
  await store.append(event("e4", "FileChanged", "e3"));
  await store.append(event("e5", "VerificationPassed", "e4"));

  assert.deepEqual((await why(store, "session_test", "e5")).events.map((item) => item.id), ["e1", "e2", "e3", "e4", "e5"]);
  assert.deepEqual((await consequences(store, "session_test", "e2")).events.map((item) => item.id), ["e2", "e3", "e4", "e5"]);
  assert.deepEqual((await causes(store, "session_test", "e4")).map((item) => item.id), ["e3"]);
});

test("causal graph rejects missing parents and conflicting duplicate ids", async () => {
  const store = new InMemoryTimelineStore();
  await assert.rejects(() => store.append(event("e2", "DecisionMade", "missing")), CausalIntegrityError);
  await store.append(event("e1", "SessionStarted"));
  await assert.rejects(() => store.append({ ...event("e1", "SessionStarted"), payload: { changed: true } }), CausalIntegrityError);
});

test("causal graph rejects cross-session ancestry", async () => {
  const store = new InMemoryTimelineStore();
  await store.append(event("e1", "SessionStarted"));
  const other = createSessionEvent({ ...base, sessionId: "session_other", id: "e2", type: "DecisionMade", causationId: "e1", payload: {} });
  await assert.rejects(() => store.append(other), CausalIntegrityError);
});
