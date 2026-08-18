import assert from "node:assert/strict";

const base = process.env.SESSIONS_API_URL ?? "http://127.0.0.1:4000";

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

const created = await request("/api/sessions", {
  method: "POST",
  body: JSON.stringify({
    objective: "prove full Sessions lifecycle and recoverable continuation",
    projectId: "project_lifecycle_qualification",
    repositoryId: "repo_lifecycle_qualification",
  }),
});
const sessionId = created.session.id;
assert.ok(sessionId.startsWith("session_"));

for (const [type, payload] of [
  ["HumanActionRecorded", { intent: "implement qualification target" }],
  ["FileChanged", { path: "src/qualification.ts", change: "created" }],
  ["CommandExecuted", { command: "npm test", exitCode: 0 }],
]) {
  await request(`/api/sessions/${sessionId}/events`, { method: "POST", body: JSON.stringify({ type, payload }) });
}

const snapshot = await request(`/api/sessions/${sessionId}/snapshots`, {
  method: "POST",
  body: JSON.stringify({ entries: [{ path: "src/qualification.ts", content: "export const qualified = true;\n" }] }),
});
assert.ok(snapshot.id);

const verification = await request(`/api/sessions/${sessionId}/verifications`, {
  method: "POST",
  body: JSON.stringify({ snapshotId: snapshot.id, kind: "test", status: "passed", summary: "qualification tests passed" }),
});
assert.equal(verification.status, "passed");

await request(`/api/sessions/${sessionId}/events`, { method: "POST", body: JSON.stringify({ type: "DeploymentStarted", payload: { environment: "qualification" } }) });
await request(`/api/sessions/${sessionId}/events`, { method: "POST", body: JSON.stringify({ type: "DeploymentCompleted", payload: { environment: "qualification", release: "qualification-1" } }) });

const rollback = await request(`/api/sessions/${sessionId}/rollback`, { method: "POST", body: JSON.stringify({ snapshotId: snapshot.id }) });
assert.equal(rollback.status, "planned");

const replay = await request(`/api/sessions/${sessionId}/replay`, { method: "POST", body: "{}" });
assert.equal(replay.mode, "recorded-event-replay");

// Defining recovery experiment: discard all local mutation state and reconstruct from only session identity.
const recoveryStarted = performance.now();
const recovered = await request(`/api/sessions/${sessionId}`);
const recoveryMs = performance.now() - recoveryStarted;
const eventTypes = new Set(recovered.events.map((event) => event.type));
for (const expected of ["SessionStarted", "HumanActionRecorded", "FileChanged", "CommandExecuted", "SnapshotCreated", "VerificationPassed", "DeploymentStarted", "DeploymentCompleted"]) {
  assert.ok(eventTypes.has(expected), `missing recovered lifecycle event ${expected}`);
}
assert.equal(recovered.session.objective, "prove full Sessions lifecycle and recoverable continuation");
assert.ok(recovered.snapshots.some((item) => item.id === snapshot.id));
assert.ok(recovered.verifications.some((item) => item.id === verification.id && item.status === "passed"));

const reconstruction = {
  sessionId,
  objective: recovered.session.objective,
  latestSnapshotId: recovered.snapshots[0]?.id ?? null,
  lastEventType: recovered.events.at(-1)?.type ?? null,
  verificationStatus: recovered.verifications[0]?.status ?? null,
  recoveryMs: Number(recoveryMs.toFixed(2)),
  recoveredEventCount: recovered.events.length,
  missingRequiredContext: 0,
  reproductionSuccess: true,
  continuationReady: Boolean(recovered.snapshots[0] && recovered.verifications[0]?.status === "passed"),
};
assert.equal(reconstruction.continuationReady, true);

console.log(JSON.stringify({ qualification: "sessions-lifecycle-recovery", passed: true, reconstruction }, null, 2));
