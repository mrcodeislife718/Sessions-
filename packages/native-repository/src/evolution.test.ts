import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkstream, checkoutWorkstream, initializeRepository, restoreCheckpoint } from "./core.js";
import { commitChange, integrateChange, listConflicts, listOperations, undoOperation } from "./evolution.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "sessions-evolution-"));
  await initializeRepository(root, "test");
  await writeFile(join(root,"file.txt"),"one\n");
  const first = await commitChange(root,{friendlyName:"first",actorIds:["human:1"]});
  return { root, first };
}

describe("native repository evolution", () => {
  it("preserves stable logical change identity across rewritten checkpoints", async () => {
    const f = await fixture();
    try {
      await writeFile(join(f.root,"file.txt"),"two\n");
      const rewritten = await commitChange(f.root,{friendlyName:"refine",changeId:f.first.change.id,actorIds:["ai:builder"]});
      assert.equal(rewritten.change.id, f.first.change.id);
      assert.deepEqual(rewritten.change.checkpointIds, [f.first.checkpoint.id, rewritten.checkpoint.id]);
      assert.notEqual(rewritten.checkpoint.id, f.first.checkpoint.id);
    } finally { await rm(f.root,{recursive:true,force:true}); }
  });

  it("records repository operations and can undo a committed state", async () => {
    const f = await fixture();
    try {
      await writeFile(join(f.root,"file.txt"),"two\n");
      const second = await commitChange(f.root,{friendlyName:"second"});
      const beforeUndo = await listOperations(f.root);
      assert.equal(beforeUndo.some(item=>item.id===second.operation.id), true);
      const undone = await undoOperation(f.root,second.operation.id,["human:1"]);
      assert.equal(undone.undone.id, second.operation.id);
      const operations = await listOperations(f.root);
      assert.equal(operations[0]?.type, "undo");
    } finally { await rm(f.root,{recursive:true,force:true}); }
  });

  it("persists merge conflicts as durable repository objects instead of transient errors", async () => {
    const f = await fixture();
    try {
      const feature = await createWorkstream(f.root,{name:"feature",fromCheckpointId:f.first.checkpoint.id});
      await checkoutWorkstream(f.root,feature.id);
      await writeFile(join(f.root,"file.txt"),"feature\n");
      await commitChange(f.root,{friendlyName:"feature-change"});
      await checkoutWorkstream(f.root,"main");
      await writeFile(join(f.root,"file.txt"),"main\n");
      await commitChange(f.root,{friendlyName:"main-change"});
      const result = await integrateChange(f.root,"feature");
      assert.equal(result.checkpoint, undefined);
      assert.equal(result.conflict?.status, "unresolved");
      assert.equal((await listConflicts(f.root,"unresolved")).length, 1);
      await restoreCheckpoint(f.root,f.first.checkpoint.id);
    } finally { await rm(f.root,{recursive:true,force:true}); }
  });
});
