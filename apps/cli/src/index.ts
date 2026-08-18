#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createCheckpoint,
  createWorkstream,
  getActiveWorkstream,
  getSourceManifest,
  initializeRepository,
  listHistory,
  listWorkstreams,
  openRepository,
  previewRestore,
  repositoryDiff,
  repositoryStatus,
  restoreCheckpoint,
  switchWorkstream,
} from "@sessions/native-repository";

const [, , command, ...args] = process.argv;
const api = process.env.SESSIONS_API_URL ?? "http://localhost:4000";
const apiToken = process.env.SESSIONS_API_TOKEN?.trim();
const root = process.cwd();
const stateDir = join(root, ".sessions");
const runtimeFile = join(stateDir, "runtime.json");

type RuntimeState = { sessionId?: string; checkpointSnapshots?: Record<string, string> };

async function loadRuntime(): Promise<RuntimeState> {
  try { return JSON.parse(await readFile(runtimeFile, "utf8")); } catch { return {}; }
}

async function saveRuntime(state: RuntimeState) {
  await mkdir(stateDir, { recursive: true });
  await writeFile(runtimeFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function request(path: string, init?: RequestInit) {
  const authHeaders = apiToken ? { authorization: `Bearer ${apiToken}` } : {};
  const response = await fetch(`${api}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...authHeaders, ...(init?.headers ?? {}) },
  });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const message = typeof body === "object" && body && "error" in body ? String((body as { error: unknown }).error) : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return body as any;
}

function requireSession(state: RuntimeState): string {
  if (!state.sessionId) throw new Error("No active Session. Run: sessions start <objective>");
  return state.sessionId;
}

function printChanges(changes: Awaited<ReturnType<typeof repositoryDiff>>) {
  if (!changes.length) {
    console.log("Clean — no source changes.");
    return;
  }
  for (const change of changes) {
    const marker = change.kind === "added" ? "+" : change.kind === "removed" ? "-" : "~";
    console.log(`${marker} ${change.path}`);
  }
}

const help = `Sessions CLI

Native source control:
  init [name]
  status
  doctor
  work <objective>
  workstream list
  workstream create <name> [objective]
  workstream switch <name-or-id>
  switch <name-or-id>
  checkpoint <name>
  history
  diff
  restore <checkpoint-name-or-id> [--apply]

Execution + intelligence:
  start <objective>
  record <EventType> [message]
  verify <kind> <passed|failed|requires_review> <summary>
  timeline
  replay
  recovery <checkpoint-id>

Hosted connection:
  SESSIONS_API_URL=https://sessions.example.com
  SESSIONS_API_TOKEN=<workspace-scoped-token>
`;

async function main() {
  const runtime = await loadRuntime();

  switch (command) {
    case "init": {
      const manifest = await initializeRepository(root, args.join(" ").trim() || undefined);
      console.log(`Initialized Sessions repository ${manifest.name}\n${manifest.id}`);
      return;
    }

    case "status": {
      const status = await repositoryStatus(root);
      const session = runtime.sessionId ? await request(`/api/sessions/${runtime.sessionId}`).catch(() => null) : null;
      console.log(`${status.repository.name}\n`);
      console.log(`Workstream  ${status.workstream.name}`);
      console.log(`Head        ${status.headCheckpoint?.friendlyName ?? "No checkpoint"}`);
      console.log(`State       ${status.clean ? "Clean" : `${status.changes.length} change(s)`}`);
      console.log(`Session     ${session ? "Active" : "None"}`);
      if (!status.clean) {
        console.log("\nChanges");
        printChanges(status.changes);
      }
      return;
    }

    case "doctor": {
      const checks: Array<[string, boolean, string]> = [];
      try {
        const repository = await openRepository(root);
        checks.push(["repository", true, repository.id]);
      } catch (error) {
        checks.push(["repository", false, error instanceof Error ? error.message : String(error)]);
      }
      try {
        const ready = await request("/ready");
        checks.push(["api", Boolean(ready?.ok), `${api}${ready?.database ? ` (${ready.database})` : ""}`]);
      } catch (error) {
        checks.push(["api", false, error instanceof Error ? error.message : String(error)]);
      }
      const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(?:\/|$)/.test(api);
      checks.push(["authentication", Boolean(apiToken) || isLocal, apiToken ? "token configured" : isLocal ? "local endpoint" : "SESSIONS_API_TOKEN is required for hosted use"]);
      for (const [name, ok, detail] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(16)} ${detail}`);
      if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
      return;
    }

    case "work": {
      const objective = args.join(" ").trim();
      if (!objective) throw new Error("Usage: sessions work <objective>");
      const current = await getActiveWorkstream(root);
      const slug = objective.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || `work-${Date.now()}`;
      const created = await createWorkstream(root, { name: slug, objective, fromCheckpointId: current.headCheckpointId });
      await switchWorkstream(root, created.id);
      console.log(`Workstream ${created.name}\nObjective: ${objective}\n${created.id}`);
      return;
    }

    case "workstream": {
      const [action, value, ...objectiveParts] = args;
      if (action === "list") {
        const active = await getActiveWorkstream(root);
        const workstreams = await listWorkstreams(root);
        for (const item of workstreams) console.log(`${item.id === active.id ? "●" : "○"} ${item.name}${item.objective ? ` — ${item.objective}` : ""}`);
        return;
      }
      if (action === "create") {
        if (!value) throw new Error("Usage: sessions workstream create <name> [objective]");
        const current = await getActiveWorkstream(root);
        const created = await createWorkstream(root, { name: value, objective: objectiveParts.join(" ") || undefined, fromCheckpointId: current.headCheckpointId });
        await switchWorkstream(root, created.id);
        console.log(`Created and switched to ${created.name}\n${created.id}`);
        return;
      }
      if (action === "switch") {
        if (!value) throw new Error("Usage: sessions workstream switch <name-or-id>");
        const active = await switchWorkstream(root, value);
        console.log(`Active Workstream: ${active.name}\n${active.id}`);
        return;
      }
      throw new Error("Usage: sessions workstream <list|create|switch>");
    }

    case "switch": {
      const reference = args.join(" ").trim();
      if (!reference) throw new Error("Usage: sessions switch <name-or-id>");
      const active = await switchWorkstream(root, reference);
      console.log(`Active Workstream: ${active.name}\n${active.id}`);
      return;
    }

    case "checkpoint": {
      const friendlyName = args.join(" ").trim();
      if (!friendlyName) throw new Error("Usage: sessions checkpoint <name>");
      const checkpoint = await createCheckpoint(root, { friendlyName, sessionIds: runtime.sessionId ? [runtime.sessionId] : [] });
      let hostedSnapshotId: string | undefined;
      if (runtime.sessionId) {
        const manifest = await getSourceManifest(root, checkpoint.sourceManifestId);
        const hosted = await request(`/api/sessions/${runtime.sessionId}/snapshots`, {
          method: "POST",
          body: JSON.stringify({ entries: manifest.entries.map((entry) => ({ path: entry.path, contentHash: entry.digest, size: entry.size })) }),
        });
        hostedSnapshotId = hosted.id;
        await saveRuntime({ ...runtime, checkpointSnapshots: { ...(runtime.checkpointSnapshots ?? {}), [checkpoint.id]: hosted.id } });
      }
      console.log(`◆ ${checkpoint.friendlyName}\n${checkpoint.id}\n${checkpoint.sourceDigest}\nRecovery: verified${hostedSnapshotId ? `\nHosted recovery: ${hostedSnapshotId}` : ""}`);
      return;
    }

    case "history": {
      const history = await listHistory(root);
      if (!history.length) return console.log("No Checkpoints yet.");
      for (const checkpoint of history) console.log(`◆ ${checkpoint.friendlyName}\n  ${checkpoint.id}  ${checkpoint.lifecycle}  ${checkpoint.createdAt}`);
      return;
    }

    case "diff": {
      printChanges(await repositoryDiff(root));
      return;
    }

    case "restore": {
      const reference = args.find((value) => value !== "--apply");
      if (!reference) throw new Error("Usage: sessions restore <checkpoint-name-or-id> [--apply]");
      const preview = await previewRestore(root, reference);
      console.log(`Restore Preview\n\nCurrent workstream: ${(await getActiveWorkstream(root)).name}\nTarget: ◆ ${preview.checkpoint.friendlyName}\nAdd: ${preview.willAdd}\nModify: ${preview.willModify}\nRemove: ${preview.willRemove}\nUncheckpointed work: ${preview.dirty ? "Detected — protection checkpoint will be created" : "None"}\nTarget integrity: ${preview.checkpoint.recovery.verified ? "Verified" : "Unverified"}`);
      if (!args.includes("--apply")) {
        console.log("\nPreview only. Re-run with --apply to restore.");
        return;
      }
      const result = await restoreCheckpoint(root, reference);
      console.log(`\nRestored ◆ ${result.restored.friendlyName}${result.protectionCheckpoint ? `\nProtected previous work as ◆ ${result.protectionCheckpoint.friendlyName}` : ""}`);
      return;
    }

    case "start": {
      const objective = args.join(" ").trim();
      if (!objective) throw new Error("Usage: sessions start <objective>");
      const repository = await openRepository(root);
      const workstream = await getActiveWorkstream(root);
      const created = await request("/api/sessions", { method: "POST", body: JSON.stringify({ objective, repositoryId: repository.id, projectId: workstream.id }) });
      await saveRuntime({ ...runtime, sessionId: created.session.id });
      console.log(`${created.session.id}\n${objective}`);
      return;
    }

    case "record": {
      const sessionId = requireSession(runtime);
      const [type, ...message] = args;
      if (!type) throw new Error("Usage: sessions record <EventType> [message]");
      console.log(JSON.stringify(await request(`/api/sessions/${sessionId}/events`, { method: "POST", body: JSON.stringify({ type, payload: { message: message.join(" ") } }) }), null, 2));
      return;
    }

    case "verify": {
      const sessionId = requireSession(runtime);
      const [kind = "custom", status = "requires_review", ...summaryParts] = args;
      const history = await listHistory(root);
      const head = history[0];
      const hostedSnapshotId = head ? runtime.checkpointSnapshots?.[head.id] : undefined;
      const result = await request(`/api/sessions/${sessionId}/verifications`, {
        method: "POST",
        body: JSON.stringify({ kind, status, snapshotId: hostedSnapshotId, summary: summaryParts.join(" ") || "CLI verification" }),
      });
      console.log(JSON.stringify({ checkpointId: head?.id, hostedSnapshotId, ...result }, null, 2));
      return;
    }

    case "timeline": {
      const sessionId = requireSession(runtime);
      const aggregate = await request(`/api/sessions/${sessionId}`);
      console.log(JSON.stringify(aggregate.events, null, 2));
      return;
    }

    case "replay": {
      const sessionId = requireSession(runtime);
      console.log(JSON.stringify(await request(`/api/sessions/${sessionId}/replay`, { method: "POST", body: "{}" }), null, 2));
      return;
    }

    case "recovery": {
      const sessionId = requireSession(runtime);
      const checkpointId = args[0];
      if (!checkpointId) throw new Error("Usage: sessions recovery <checkpoint-id>");
      const hostedSnapshotId = runtime.checkpointSnapshots?.[checkpointId];
      if (!hostedSnapshotId) throw new Error(`Checkpoint ${checkpointId} has no hosted recovery snapshot in the active Session`);
      console.log(JSON.stringify(await request(`/api/sessions/${sessionId}/rollback`, { method: "POST", body: JSON.stringify({ snapshotId: hostedSnapshotId }) }), null, 2));
      return;
    }

    default:
      console.log(help);
  }
}

main().catch((error) => {
  console.error(`Sessions: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
