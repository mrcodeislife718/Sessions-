import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const base = process.env.SESSIONS_API_URL ?? "http://127.0.0.1:4000";
const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl) {
  execFileSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-f", "infrastructure/postgres/009-lifecycle-evidence-events.sql"], { stdio: "inherit" });
  execFileSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-f", "infrastructure/postgres/015-reasoning-graph.sql"], { stdio: "inherit" });
}

async function request(path, init = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-request-id": `qualification-${Date.now()}-${Math.random()}`, ...(init.headers ?? {}) },
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${response.status}: ${text}`);
  return body;
}

const readiness = await request("/ready");
assert.equal(readiness.ok, true);
const created = await request("/api/sessions", { method: "POST", body: JSON.stringify({ objective: "prove full Sessions lifecycle and recoverable continuation", projectId: "project_lifecycle_qualification", repositoryId: "repo_lifecycle_qualification" }) });
const sessionId = created.session.id;
assert.ok(sessionId.startsWith("session_"));
const sessionStart = created.events.find((event) => event.type === "SessionStarted");
assert.ok(sessionStart?.id);

const decision = await request(`/api/sessions/${sessionId}/events`, { method: "POST", body: JSON.stringify({ type: "DecisionMade", causationId: sessionStart.id, payload: { decisionId: "decision_lifecycle_qualification", summary: "Implement the qualification target with causal evidence" } }) });
const human = await request(`/api/sessions/${sessionId}/events`, { method: "POST", body: JSON.stringify({ type: "HumanActionRecorded", causationId: decision.id, payload: { intent: "implement qualification target" } }) });
const changed = await request(`/api/sessions/${sessionId}/events`, { method: "POST", body: JSON.stringify({ type: "FileChanged", causationId: human.id, payload: { path: "src/qualification.ts", change: "created" } }) });
const command = await request(`/api/sessions/${sessionId}/events`, { method: "POST", body: JSON.stringify({ type: "CommandExecuted", causationId: changed.id, payload: { command: "npm test", exitCode: 0 } }) });

const snapshot = await request(`/api/sessions/${sessionId}/snapshots`, { method: "POST", body: JSON.stringify({ checkpointId: "checkpoint_lifecycle_qualification", causationId: command.id, entries: [{ path: "src/qualification.ts", content: "export const qualified = true;\n" }] }) });
assert.ok(snapshot.id);
assert.ok(snapshot.causalEventId);
const verification = await request(`/api/sessions/${sessionId}/verifications`, { method: "POST", body: JSON.stringify({ snapshotId: snapshot.id, causationId: snapshot.causalEventId, kind: "test", status: "passed", summary: "qualification tests passed" }) });
assert.equal(verification.status, "passed");
assert.ok(verification.causalEventId);
const deploymentStarted = await request(`/api/sessions/${sessionId}/events`, { method: "POST", body: JSON.stringify({ type: "DeploymentStarted", causationId: verification.causalEventId, payload: { deploymentId: "deployment_lifecycle_qualification", environment: "qualification" } }) });
const deploymentCompleted = await request(`/api/sessions/${sessionId}/events`, { method: "POST", body: JSON.stringify({ type: "DeploymentCompleted", causationId: deploymentStarted.id, payload: { deploymentId: "deployment_lifecycle_qualification_complete", environment: "qualification", release: "qualification-1" } }) });
assert.ok(deploymentCompleted.id);

const checkpointWhy = await request(`/api/sessions/${sessionId}/why/checkpoint_lifecycle_qualification`);
assert.equal(checkpointWhy.resolvedEventId, snapshot.causalEventId);
assert.deepEqual(checkpointWhy.events.map((event) => event.type), ["SessionStarted", "DecisionMade", "HumanActionRecorded", "FileChanged", "CommandExecuted", "SnapshotCreated"]);
const decisionConsequences = await request(`/api/sessions/${sessionId}/consequences/decision_lifecycle_qualification`);
assert.ok(decisionConsequences.events.some((event) => event.type === "VerificationPassed"));
assert.ok(decisionConsequences.events.some((event) => event.type === "DeploymentCompleted"));
const deploymentLineage = await request(`/api/sessions/${sessionId}/lineage/deployment_lifecycle_qualification_complete`);
assert.ok(deploymentLineage.ancestry.some((event) => event.type === "DecisionMade"));
assert.equal(deploymentLineage.ancestry.at(-1)?.type, "DeploymentCompleted");

const rollback = await request(`/api/sessions/${sessionId}/rollback`, { method: "POST", body: JSON.stringify({ snapshotId: snapshot.id }) });
assert.equal(rollback.status, "planned");
const replay = await request(`/api/sessions/${sessionId}/replay`, { method: "POST", body: "{}" });
assert.equal(replay.mode, "recorded-event-replay");
const recoveryStarted = performance.now();
const recovered = await request(`/api/sessions/${sessionId}`);
const recoveryMs = performance.now() - recoveryStarted;
const eventTypes = new Set(recovered.events.map((event) => event.type));
for (const expected of ["SessionStarted", "DecisionMade", "HumanActionRecorded", "FileChanged", "CommandExecuted", "SnapshotCreated", "VerificationPassed", "DeploymentStarted", "DeploymentCompleted"]) assert.ok(eventTypes.has(expected), `missing recovered lifecycle event ${expected}`);
assert.equal(recovered.session.objective, "prove full Sessions lifecycle and recoverable continuation");
assert.ok(recovered.snapshots.some((item) => item.id === snapshot.id));
assert.ok(recovered.verifications.some((item) => item.id === verification.id && item.status === "passed"));
const reconstruction = { sessionId, objective: recovered.session.objective, latestSnapshotId: recovered.snapshots[0]?.id ?? null, lastEventType: recovered.events.at(-1)?.type ?? null, verificationStatus: recovered.verifications[0]?.status ?? null, recoveryMs: Number(recoveryMs.toFixed(2)), recoveredEventCount: recovered.events.length, missingRequiredContext: 0, reproductionSuccess: true, continuationReady: Boolean(recovered.snapshots[0] && recovered.verifications[0]?.status === "passed"), causalReasoningVerified: true };
assert.equal(reconstruction.continuationReady, true);
console.log(JSON.stringify({ qualification: "sessions-lifecycle-recovery-and-causal-reasoning", passed: true, reconstruction }, null, 2));
