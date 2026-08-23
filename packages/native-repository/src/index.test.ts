import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  checkoutWorkstream,
  createCheckpoint,
  createWorkstream,
  initializeRepository,
  integrateWorkstream,
  listStaged,
  previewIntegration,
  repositoryStatus,
  restoreCheckpoint,
  stagePaths,
  stagedDiff,
  unstagePaths,
  verifyRepositoryIntegrity,
} from "./index.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "sessions-native-"));
  await initializeRepository(root, "fixture");
  return root;
}

test("staging freezes the staged bytes until restaged", async () => {
  const root = await fixture();
  try {
    await writeFile(join(root, "app.txt"), "one\n");
    await stagePaths(root, ["app.txt"]);
    await writeFile(join(root, "app.txt"), "two\n");
    const staged = await stagedDiff(root);
    const status = await repositoryStatus(root);
    assert.equal(staged.length, 1);
    assert.equal(status.stagedChanges.length, 1);
    assert.equal(status.unstagedChanges.length, 1);
    const checkpoint = await createCheckpoint(root, { friendlyName: "frozen" });
    assert.ok(checkpoint.id.startsWith("cp_"));
    assert.equal((await listStaged(root)).length, 0);
    assert.equal((await repositoryStatus(root)).unstagedChanges.length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("deletions can be staged and checkpointed", async () => {
  const root = await fixture();
  try {
    await writeFile(join(root, "remove-me.txt"), "data");
    await stagePaths(root, ["."]);
    await createCheckpoint(root, { friendlyName: "baseline" });
    await rm(join(root, "remove-me.txt"));
    await stagePaths(root, ["."]);
    assert.equal((await stagedDiff(root))[0]?.kind, "removed");
    await createCheckpoint(root, { friendlyName: "removed" });
    assert.equal((await repositoryStatus(root)).clean, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("unstage preserves working-tree changes", async () => {
  const root = await fixture();
  try {
    await writeFile(join(root, "a.txt"), "a");
    await stagePaths(root, ["a.txt"]);
    await unstagePaths(root, ["a.txt"]);
    const status = await repositoryStatus(root);
    assert.equal(status.stagedChanges.length, 0);
    assert.equal(status.unstagedChanges.length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("workstream checkout refuses dirty state and reconstructs clean target", async () => {
  const root = await fixture();
  try {
    await writeFile(join(root, "state.txt"), "main");
    await stagePaths(root, ["."]);
    const baseline = await createCheckpoint(root, { friendlyName: "main" });
    const feature = await createWorkstream(root, { name: "feature", fromCheckpointId: baseline.id });
    await checkoutWorkstream(root, feature.id);
    await writeFile(join(root, "state.txt"), "feature");
    await assert.rejects(() => checkoutWorkstream(root, "main"), /staged or unstaged changes/);
    await stagePaths(root, ["."]);
    await createCheckpoint(root, { friendlyName: "feature-state" });
    await checkoutWorkstream(root, "main");
    assert.equal(await readFile(join(root, "state.txt"), "utf8"), "main");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("integration detects overlapping conflicts", async () => {
  const root = await fixture();
  try {
    await writeFile(join(root, "shared.txt"), "base");
    await stagePaths(root, ["."]);
    const baseline = await createCheckpoint(root, { friendlyName: "base" });
    const feature = await createWorkstream(root, { name: "feature", fromCheckpointId: baseline.id });
    await checkoutWorkstream(root, feature.id);
    await writeFile(join(root, "shared.txt"), "feature");
    await stagePaths(root, ["."]);
    await createCheckpoint(root, { friendlyName: "feature-change" });
    await checkoutWorkstream(root, "main");
    await writeFile(join(root, "shared.txt"), "main");
    await stagePaths(root, ["."]);
    await createCheckpoint(root, { friendlyName: "main-change" });
    const preview = await previewIntegration(root, "feature");
    assert.equal(preview.canIntegrate, false);
    assert.equal(preview.conflicts[0]?.path, "shared.txt");
    await assert.rejects(() => integrateWorkstream(root, "feature"), /conflict/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("restore protects dirty work before reconstruction", async () => {
  const root = await fixture();
  try {
    await writeFile(join(root, "state.txt"), "safe");
    await stagePaths(root, ["."]);
    const safe = await createCheckpoint(root, { friendlyName: "safe" });
    await writeFile(join(root, "state.txt"), "dirty");
    const result = await restoreCheckpoint(root, safe.id);
    assert.ok(result.protectionCheckpoint);
    assert.equal(await readFile(join(root, "state.txt"), "utf8"), "safe");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("integrity audit validates stored checkpoint objects", async () => {
  const root = await fixture();
  try {
    await writeFile(join(root, "a.txt"), "a");
    await stagePaths(root, ["."]);
    await createCheckpoint(root, { friendlyName: "one" });
    const result = await verifyRepositoryIntegrity(root);
    assert.equal(result.ok, true);
    assert.equal(result.checkedCheckpoints, 1);
    assert.equal(result.checkedObjects, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
