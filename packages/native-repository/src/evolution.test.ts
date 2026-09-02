import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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
      expect(rewritten.change.id).toBe(f.first.change.id);
      expect(rewritten.change.checkpointIds).toEqual([f.first.checkpoint.id, rewritten.checkpoint.id]);
      expect(rewritten.checkpoint.id).not.toBe(f.first.checkpoint.id);
    } finally { await rm(f.root,{recursive:true,force:true}); }
  });

  it("records repository operations and can undo a committed state", async () => {
    const f = await fixture();
    try {
      await writeFile(join(f.root,"file.txt"),"two\n");
      const second = await commitChange(f.root,{friendlyName:"second"});
      const beforeUndo = await listOperations(f.root);
      expect(beforeUndo.some(item=>item.id===second.operation.id)).toBe(true);
      const undone = await undoOperation(f.root,second.operation.id,["human:1"]);
      expect(undone.undone.id).toBe(second.operation.id);
      const operations = await listOperations(f.root);
      expect(operations[0].type).toBe("undo");
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
      expect(result.checkpoint).toBeUndefined();
      expect(result.conflict?.status).toBe("unresolved");
      expect((await listConflicts(f.root,"unresolved")).length).toBe(1);
      await restoreCheckpoint(f.root,f.first.checkpoint.id);
    } finally { await rm(f.root,{recursive:true,force:true}); }
  });
});
