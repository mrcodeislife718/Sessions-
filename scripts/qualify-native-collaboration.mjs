import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const api = process.env.SESSIONS_API_QUALIFICATION_URL ?? "http://127.0.0.1:4000";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const stable = (value) => JSON.stringify(value, Object.keys(value).sort());

async function request(path, options = {}) {
  const response = await fetch(`${api}${path}`, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${path}: ${response.status} ${body.error ?? JSON.stringify(body)}`);
  return body;
}

async function waitFor(label, fn, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} did not become ready; last=${JSON.stringify(last)}`);
}

async function uploadObject(repositoryId, content) {
  const objectDigest = digest(content);
  const objectId = `obj_${objectDigest}`;
  const plan = await request(`/api/repositories/${encodeURIComponent(repositoryId)}/objects/plan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ objects: [{ objectId, digest: objectDigest, size: content.length }] }),
  });
  if (plan.missing.includes(objectId)) {
    await request(`/api/repositories/${encodeURIComponent(repositoryId)}/objects/${encodeURIComponent(objectId)}?digest=${objectDigest}&size=${content.length}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: Uint8Array.from(content).buffer,
    });
  }
  return { objectId, digest: objectDigest, size: content.length };
}

const repositoryId = `repo_native_e2e_${Date.now()}`;
const repositoryName = `native-e2e-${Date.now()}`;
const mainWorkstreamId = "workstream_main";
const featureWorkstreamId = "workstream_feature";

await request("/api/repositories", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ id: repositoryId, name: repositoryName, defaultBranchId: mainWorkstreamId, visibility: "private" }),
});

const baseObject = await uploadObject(repositoryId, Buffer.from("base\n"));
const featureObject = await uploadObject(repositoryId, Buffer.from("feature\n"));

const baseManifest = {
  version: 1,
  id: `manifest_${digest(Buffer.from(`base:${baseObject.digest}`))}`,
  repositoryId,
  entries: [{ path: "app.txt", ...baseObject }],
  sourceDigest: digest(Buffer.from(`tree:${baseObject.digest}`)),
};
const headManifest = {
  version: 1,
  id: `manifest_${digest(Buffer.from(`feature:${featureObject.digest}`))}`,
  repositoryId,
  entries: [{ path: "app.txt", ...featureObject }],
  sourceDigest: digest(Buffer.from(`tree:${featureObject.digest}`)),
};
const createdAt = new Date().toISOString();
const baseCheckpointId = `cp_${digest(Buffer.from(`base:${repositoryId}`)).slice(0,24)}`;
const headCheckpointId = `cp_${digest(Buffer.from(`head:${repositoryId}`)).slice(0,24)}`;
const baseCheckpoint = {
  version: 1, id: baseCheckpointId, friendlyName: "Base", repositoryId, workstreamId: mainWorkstreamId,
  parentCheckpointIds: [], sourceManifestId: baseManifest.id, sourceDigest: baseManifest.sourceDigest,
  lifecycle: "verified", objective: "Establish native base", actorIds: ["human_local"], sessionIds: [], verificationIds: [], approvalIds: [],
  recovery: { reconstructable: true, verified: true }, createdAt,
};
const headCheckpoint = {
  version: 1, id: headCheckpointId, friendlyName: "Feature", repositoryId, workstreamId: featureWorkstreamId,
  parentCheckpointIds: [baseCheckpointId], sourceManifestId: headManifest.id, sourceDigest: headManifest.sourceDigest,
  lifecycle: "verified", objective: "Qualify native collaboration", actorIds: ["human_local"], sessionIds: [], verificationIds: [], approvalIds: [],
  recovery: { reconstructable: true, verified: true }, createdAt: new Date(Date.now()+1).toISOString(),
};
const repository = { version: 1, id: repositoryId, name: repositoryName, createdAt, defaultWorkstreamId: mainWorkstreamId, hashAlgorithm: "sha256" };
const branches = [
  { id: mainWorkstreamId, repositoryId, name: "main", headCheckpointId: baseCheckpointId, createdAt, updatedAt: createdAt },
  { id: featureWorkstreamId, repositoryId, name: "feature", headCheckpointId, objective: "Qualify native collaboration", createdAt, updatedAt: createdAt },
];
const refs = branches.map((branch) => ({ refType: "branch", name: branch.name, checkpointId: branch.headCheckpointId, metadata: { id: branch.id, objective: branch.objective, createdAt: branch.createdAt, updatedAt: branch.updatedAt } }));

const pushed = await request(`/api/repositories/${encodeURIComponent(repositoryId)}/state`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    version: 1,
    protocol: "sessions-native",
    state: { repository, state: { activeWorkstreamId: featureWorkstreamId }, branches, tags: [] },
    refs,
    checkpoints: [baseCheckpoint, headCheckpoint],
    manifests: [baseManifest, headManifest],
    sourceDigest: headManifest.sourceDigest,
  }),
});
assert.ok(pushed.actionRunId, "native push should enqueue an Action");

const pushAction = await waitFor("native push Action", async () => {
  const actions = await request(`/api/repositories/${encodeURIComponent(repositoryId)}/actions`);
  return actions.find((run) => run.id === pushed.actionRunId && run.status === "completed") ?? null;
});
assert.equal(pushAction.conclusion, "success");
assert.equal(pushAction.checks.length, 3);
assert.ok(pushAction.checks.every((check) => check.conclusion === "success"));

const pull = await request(`/api/repositories/${encodeURIComponent(repositoryId)}/pulls`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ title: "Native feature", body: "HTTP end-to-end qualification", baseBranch: "main", headBranch: "feature", headCommitId: headCheckpointId, requiredApprovals: 0 }),
});
assert.ok(pull.actionRunId, "pull request should enqueue native verification");

const verifiedPull = await waitFor("pull request verification", async () => {
  const pulls = await request(`/api/repositories/${encodeURIComponent(repositoryId)}/pulls`);
  return pulls.find((item) => item.number === pull.number && item.verification_state === "passed") ?? null;
});
assert.equal(verifiedPull.mergeable, true);

const merged = await request(`/api/repositories/${encodeURIComponent(repositoryId)}/pulls/${pull.number}/merge`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}",
});
assert.equal(merged.state, "merged");
assert.equal(merged.merge_commit_id, headCheckpointId);
assert.equal(merged.mergeMode, "fast_forward");

const finalState = await request(`/api/repositories/${encodeURIComponent(repositoryId)}/state`);
const mainRef = finalState.refs.find((ref) => ref.ref_type === "branch" && ref.name === "main");
assert.equal(mainRef.checkpoint_id, headCheckpointId, "native main ref must advance to verified PR head");
assert.equal(finalState.repository.source_digest, headManifest.sourceDigest, "default branch source digest must advance with native merge");

const actions = await request(`/api/repositories/${encodeURIComponent(repositoryId)}/actions`);
const prAction = actions.find((run) => run.id === pull.actionRunId);
assert.equal(prAction?.conclusion, "success");
assert.ok(prAction?.checks.every((check) => check.conclusion === "success"));

console.log(JSON.stringify({
  ok: true,
  protocol: "sessions-native",
  repositoryId,
  pushActionId: pushed.actionRunId,
  pullRequest: pull.number,
  pullRequestActionId: pull.actionRunId,
  mergedCommitId: headCheckpointId,
  canonicalMain: mainRef.checkpoint_id,
}, null, 2));
