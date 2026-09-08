import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  createCheckpoint,
  createWorkstream,
  initializeRepository,
  listHistory,
  listWorkstreams,
  stagePaths,
  switchWorkstream,
} from "./core.js";
import { createTag, importGitRepository, listTags } from "./transport.js";
import { exportGitRepository } from "./git-compat.js";

const execFileAsync = promisify(execFile);
async function git(cwd:string,args:string[]){return (await execFileAsync("git",args,{cwd})).stdout.trim();}

test("Sessions exports native history to Git and re-imports representative branches/tags/source", async () => {
  const root = await mkdtemp(join(tmpdir(), "sessions-git-roundtrip-"));
  const native = join(root, "native");
  const exported = join(root, "exported-git");
  const reimported = join(root, "reimported");
  try {
    await initializeRepository(native, "roundtrip");
    await writeFile(join(native, "README.md"), "main-v1\n");
    await stagePaths(native, ["README.md"]);
    const first = await createCheckpoint(native, { friendlyName:"initial", actorIds:["Tester <tester@example.com>"] });

    await createWorkstream(native, { name:"feature", fromCheckpointId:first.id });
    await switchWorkstream(native, "feature");
    await writeFile(join(native, "feature.txt"), "feature\n");
    await stagePaths(native, ["feature.txt"]);
    const feature = await createCheckpoint(native, { friendlyName:"feature-work", actorIds:["Agent <agent@example.com>"] });
    await createTag(native, "feature-ready", feature.id, "feature checkpoint");

    await switchWorkstream(native, "main");
    await writeFile(join(native, "README.md"), "main-v2\n");
    await stagePaths(native, ["README.md"]);
    await createCheckpoint(native, { friendlyName:"main-update", actorIds:["Tester <tester@example.com>"] });

    const result = await exportGitRepository(native, exported);
    assert.equal(result.branches, 2);
    assert.equal(result.tags, 1);
    assert.equal(await git(exported,["show","main:README.md"]), "main-v2");
    assert.equal(await git(exported,["show","feature:feature.txt"]), "feature");
    assert.equal(await git(exported,["rev-parse","feature-ready"]), await git(exported,["rev-parse","feature"]));

    const imported = await importGitRepository(exported, reimported);
    assert.ok(imported.commits >= 3);
    const branches = await listWorkstreams(reimported);
    const tags = await listTags(reimported);
    const history = await listHistory(reimported);
    assert.ok(branches.some((branch)=>branch.name==="main"));
    assert.ok(branches.some((branch)=>branch.name==="feature"));
    assert.ok(tags.some((tag)=>tag.name==="feature-ready"));
    assert.ok(history.length >= 3);
  } finally {
    await rm(root, { recursive:true, force:true });
  }
});
