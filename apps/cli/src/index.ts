#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createCheckpoint,
  createWorkstream,
  getActiveWorkstream,
  initializeRepository,
  listHistory,
  listWorkstreams,
  openRepository,
  repositoryStatus,
  switchWorkstream,
} from "@sessions/native-repository";

const [, , command, ...args] = process.argv;
const api = process.env.SESSIONS_API_URL ?? "http://localhost:4000";
const root = process.cwd();
const stateDir = join(root, ".sessions");
const runtimeFile = join(stateDir, "runtime.json");

type RuntimeState = { sessionId?: string };

async function loadRuntime(): Promise<RuntimeState> {
  try { return JSON.parse(await readFile(runtimeFile, "utf8")); } catch { return {}; }
}

async function saveRuntime(state: RuntimeState) {
  await mkdir(stateDir, { recursive: true });
  await writeFile(runtimeFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${api}${path}`, { headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, ...init });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

function requireSession(state: RuntimeState): string {
  if (!state.sessionId) throw new Error("No active Session. Run: sessions start <objective>");
  return state.sessionId;
}

const help = `Sessions CLI

Native source control:
  init [name]
  status
  workstream list
  workstream create <name> [objective]
  workstream switch <workstream-id>
  checkpoint <name>
  history

Execution + intelligence:
  start <objective>
  record <EventType> [message]
  verify <kind> <passed|failed|requires_review> <summary>
  timeline
  replay
  rollback <checkpoint-id>
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
      console.log(JSON.stringify({ repository: status, activeSession: session }, null, 2));
      return;
    }

    case "workstream": {
      const [action, value, ...objectiveParts] = args;
      if (action === "list") {
        const active = await getActiveWorkstream(root);
        const workstreams = await listWorkstreams(root);
        console.log(JSON.stringify(workstreams.map((item) => ({ ...item, active: item.id === active.id })), null, 2));
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
        if (!value) throw new Error("Usage: sessions workstream switch <workstream-id>");
        await switchWorkstream(root, value);
        const active = await getActiveWorkstream(root);
        console.log(`Active Workstream: ${active.name}\n${active.id}`);
        return;
      }
      throw new Error("Usage: sessions workstream <list|create|switch>");
    }

    case "checkpoint": {
      const friendlyName = args.join(" ").trim();
      if (!friendlyName) throw new Error("Usage: sessions checkpoint <name>");
      const checkpoint = await createCheckpoint(root, { friendlyName });
      if (runtime.sessionId) {
        await request(`/api/sessions/${runtime.sessionId}/snapshots`, {
          method: "POST",
          body: JSON.stringify({
            entries: checkpoint.entries.map((entry) => ({ path: entry.path, contentHash: entry.digest, size: entry.size })),
          }),
        });
      }
      console.log(JSON.stringify(checkpoint, null, 2));
      return;
    }

    case "history": {
      console.log(JSON.stringify(await listHistory(root), null, 2));
      return;
    }

    case "start": {
      const objective = args.join(" ").trim();
      if (!objective) throw new Error("Usage: sessions start <objective>");
      const repository = await openRepository(root);
      const workstream = await getActiveWorkstream(root);
      const created = await request("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ objective, repositoryId: repository.id, projectId: workstream.id }),
      });
      await saveRuntime({ sessionId: created.session.id });
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
      const result = await request(`/api/sessions/${sessionId}/verifications`, {
        method: "POST",
        body: JSON.stringify({ kind, status, snapshotId: head?.id, summary: summaryParts.join(" ") || "CLI verification" }),
      });
      console.log(JSON.stringify(result, null, 2));
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

    case "rollback": {
      const sessionId = requireSession(runtime);
      const checkpointId = args[0];
      if (!checkpointId) throw new Error("Usage: sessions rollback <checkpoint-id>");
      console.log(JSON.stringify(await request(`/api/sessions/${sessionId}/rollback`, { method: "POST", body: JSON.stringify({ snapshotId: checkpointId }) }), null, 2));
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
