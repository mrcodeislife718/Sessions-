import {
  checkoutWorkstream,
  createCheckpoint,
  createWorkstream,
  getActiveWorkstream,
  integrateWorkstream,
  listHistory,
  listStaged,
  listWorkstreams,
  previewIntegration,
  previewRestore,
  repositoryDiff,
  repositoryStatus,
  restoreCheckpoint,
  stagePaths,
  stagedDiff,
  unstagePaths,
  unstagedDiff,
  verifyRepositoryIntegrity,
} from "@sessions/native-repository";

function marker(kind: string) { return kind === "added" ? "+" : kind === "removed" ? "-" : "~"; }
function printChanges(changes: Array<{ path: string; kind: string }>, empty = "No changes.") {
  if (!changes.length) return console.log(empty);
  for (const change of changes) console.log(`${marker(change.kind)} ${change.path}`);
}

export async function handleNativeCommand(command: string | undefined, args: string[], root: string): Promise<boolean> {
  switch (command) {
    case "status": {
      const status = await repositoryStatus(root);
      console.log(`${status.repository.name}\n`);
      console.log(`Workstream   ${status.workstream.name}`);
      console.log(`Head         ${status.headCheckpoint?.friendlyName ?? "No checkpoint"}`);
      console.log(`State        ${status.clean ? "Clean" : "Changes present"}`);
      console.log(`Staged       ${status.stagedChanges.length}`);
      console.log(`Unstaged     ${status.unstagedChanges.length}`);
      if (status.stagedChanges.length) { console.log("\nStaged Changes"); printChanges(status.stagedChanges); }
      if (status.unstagedChanges.length) { console.log("\nChanges"); printChanges(status.unstagedChanges); }
      return true;
    }
    case "add": {
      const staged = await stagePaths(root, args.length ? args : ["."]);
      console.log(`Staged ${staged.length} path(s).`);
      printChanges(await stagedDiff(root), "Nothing staged.");
      return true;
    }
    case "unstage": {
      const remaining = await unstagePaths(root, args.length ? args : ["."]);
      console.log(remaining.length ? `${remaining.length} staged path(s) remain.` : "Stage cleared.");
      return true;
    }
    case "staged": {
      const staged = await listStaged(root);
      if (!staged.length) console.log("Nothing staged.");
      else for (const item of staged) console.log(`${item.operation === "remove" ? "-" : "+"} ${item.path}`);
      return true;
    }
    case "diff": {
      if (args.includes("--staged")) printChanges(await stagedDiff(root), "No staged changes.");
      else if (args.includes("--unstaged")) printChanges(await unstagedDiff(root), "No unstaged changes.");
      else printChanges(await repositoryDiff(root), "No changes.");
      return true;
    }
    case "work": {
      const objective = args.join(" ").trim();
      if (!objective) throw new Error("Usage: sessions work <objective>");
      const current = await getActiveWorkstream(root);
      const slug = objective.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || `work-${Date.now()}`;
      const created = await createWorkstream(root, { name: slug, objective, fromCheckpointId: current.headCheckpointId });
      const active = await checkoutWorkstream(root, created.id);
      console.log(`Workstream ${active.name}\nObjective: ${objective}\n${active.id}`);
      return true;
    }
    case "workstream": {
      const [action, value, ...objectiveParts] = args;
      if (action === "list") {
        const active = await getActiveWorkstream(root);
        for (const item of await listWorkstreams(root)) console.log(`${item.id === active.id ? "●" : "○"} ${item.name}${item.objective ? ` — ${item.objective}` : ""}`);
        return true;
      }
      if (action === "create") {
        if (!value) throw new Error("Usage: sessions workstream create <name> [objective]");
        const current = await getActiveWorkstream(root);
        const created = await createWorkstream(root, { name: value, objective: objectiveParts.join(" ") || undefined, fromCheckpointId: current.headCheckpointId });
        const active = await checkoutWorkstream(root, created.id);
        console.log(`Created and switched to ${active.name}\n${active.id}`);
        return true;
      }
      if (action === "switch") {
        if (!value) throw new Error("Usage: sessions workstream switch <name-or-id>");
        const active = await checkoutWorkstream(root, value);
        console.log(`Active Workstream: ${active.name}\n${active.id}`);
        return true;
      }
      throw new Error("Usage: sessions workstream <list|create|switch>");
    }
    case "switch": {
      const reference = args.join(" ").trim();
      if (!reference) throw new Error("Usage: sessions switch <name-or-id>");
      const active = await checkoutWorkstream(root, reference);
      console.log(`Active Workstream: ${active.name}\n${active.id}`);
      return true;
    }
    case "history": {
      const history = await listHistory(root);
      if (!history.length) console.log("No Checkpoints yet.");
      else for (const checkpoint of history) console.log(`◆ ${checkpoint.friendlyName}\n  ${checkpoint.id}  ${checkpoint.lifecycle}  ${checkpoint.createdAt}`);
      return true;
    }
    case "integrate": {
      const source = args.find((value) => value !== "--apply");
      if (!source) throw new Error("Usage: sessions integrate <workstream> [--apply]");
      const preview = await previewIntegration(root, source);
      console.log(`Integration Preview\n\nSource       ${preview.source.name}\nTarget       ${preview.target.name}\nIncoming     ${preview.incomingChanges.length}\nTarget work  ${preview.targetChanges.length}\nConflicts    ${preview.conflicts.length}\nMode         ${preview.fastForward ? "Fast-forward" : "Three-way"}`);
      if (preview.conflicts.length) for (const conflict of preview.conflicts) console.log(`! ${conflict.path}`);
      if (!args.includes("--apply")) console.log("\nPreview only. Re-run with --apply to integrate.");
      else {
        const result = await integrateWorkstream(root, source);
        console.log(result.checkpoint ? `\nIntegrated ${preview.source.name} → ${preview.target.name}\n◆ ${result.checkpoint.friendlyName}` : "\nNothing to integrate.");
      }
      return true;
    }
    case "restore": {
      const reference = args.find((value) => value !== "--apply");
      if (!reference) throw new Error("Usage: sessions restore <checkpoint-name-or-id> [--apply]");
      const preview = await previewRestore(root, reference);
      console.log(`Restore Preview\n\nCurrent workstream: ${(await getActiveWorkstream(root)).name}\nTarget: ◆ ${preview.checkpoint.friendlyName}\nAdd: ${preview.willAdd}\nModify: ${preview.willModify}\nRemove: ${preview.willRemove}\nUncheckpointed work: ${preview.dirty ? "Detected — protection Checkpoint will be created" : "None"}\nTarget integrity: ${preview.checkpoint.recovery.verified ? "Verified" : "Unverified"}`);
      if (!args.includes("--apply")) console.log("\nPreview only. Re-run with --apply to restore.");
      else {
        const stagedBeforeRestore = await listStaged(root);
        if (stagedBeforeRestore.length) await unstagePaths(root, ["."]);
        const result = await restoreCheckpoint(root, reference);
        console.log(`\nRestored ◆ ${result.restored.friendlyName}${result.protectionCheckpoint ? `\nProtected the complete pre-restore working tree as ◆ ${result.protectionCheckpoint.friendlyName}` : ""}`);
      }
      return true;
    }
    case "integrity": {
      const result = await verifyRepositoryIntegrity(root);
      console.log(`Repository integrity: ${result.ok ? "OK" : "FAILED"}\nCheckpoints: ${result.checkedCheckpoints}\nObjects: ${result.checkedObjects}`);
      if (result.errors.length) for (const error of result.errors) console.log(`! ${error}`);
      if (!result.ok) process.exitCode = 2;
      return true;
    }
    default: return false;
  }
}

export async function createLocalCheckpoint(root: string, name: string, sessionId?: string) {
  return createCheckpoint(root, { friendlyName: name, sessionIds: sessionId ? [sessionId] : [] });
}
