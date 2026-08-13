#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [, , command, ...args] = process.argv;
const api = process.env.SESSIONS_API_URL ?? "http://localhost:4000";
const stateDir = join(process.cwd(), ".sessions");
const stateFile = join(stateDir, "state.json");

type LocalState = { sessionId?: string; repositoryId?: string };

async function loadState(): Promise<LocalState> {
  try { return JSON.parse(await readFile(stateFile, "utf8")); } catch { return {}; }
}
async function saveState(state: LocalState) {
  await mkdir(stateDir, { recursive: true });
  await writeFile(stateFile, JSON.stringify(state, null, 2));
}
async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${api}${path}`, { headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, ...init });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}
function requireSession(state: LocalState): string {
  if (!state.sessionId) throw new Error("No active Session. Run: sessions start <objective>");
  return state.sessionId;
}

const help = `Sessions CLI\n\nCommands:\n  init [repository-id]\n  start <objective>\n  checkpoint <path:hash:size>...\n  verify <kind> <passed|failed|requires_review> <summary>\n  timeline\n  replay\n  rollback <snapshot-id>\n  status\n`;

async function main() {
  const state = await loadState();
  switch (command) {
    case "init": {
      const repositoryId = args[0] ?? process.cwd().split(/[\\/]/).pop() ?? "repository_local";
      await saveState({ ...state, repositoryId });
      console.log(`Sessions initialized for ${repositoryId}`);
      return;
    }
    case "start": {
      const objective = args.join(" ").trim();
      if (!objective) throw new Error("Usage: sessions start <objective>");
      const repositoryId = state.repositoryId ?? process.cwd().split(/[\\/]/).pop() ?? "repository_local";
      const created = await request("/api/sessions", { method: "POST", body: JSON.stringify({ objective, repositoryId }) });
      await saveState({ repositoryId, sessionId: created.session.id });
      console.log(`${created.session.id}\n${objective}`);
      return;
    }
    case "checkpoint": {
      const sessionId = requireSession(state);
      const entries = args.map((item) => {
        const [path, contentHash, size = "0"] = item.split(":");
        return { path, contentHash, size: Number(size) };
      });
      const snapshot = await request(`/api/sessions/${sessionId}/snapshots`, { method: "POST", body: JSON.stringify({ entries }) });
      console.log(JSON.stringify(snapshot, null, 2));
      return;
    }
    case "verify": {
      const sessionId = requireSession(state);
      const [kind = "custom", status = "requires_review", ...summaryParts] = args;
      const result = await request(`/api/sessions/${sessionId}/verifications`, { method: "POST", body: JSON.stringify({ kind, status, summary: summaryParts.join(" ") || "CLI verification" }) });
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    case "timeline":
    case "status": {
      const sessionId = requireSession(state);
      const aggregate = await request(`/api/sessions/${sessionId}`);
      console.log(JSON.stringify(command === "timeline" ? aggregate.events : aggregate, null, 2));
      return;
    }
    case "replay": {
      const sessionId = requireSession(state);
      console.log(JSON.stringify(await request(`/api/sessions/${sessionId}/replay`, { method: "POST", body: "{}" }), null, 2));
      return;
    }
    case "rollback": {
      const sessionId = requireSession(state);
      const snapshotId = args[0];
      if (!snapshotId) throw new Error("Usage: sessions rollback <snapshot-id>");
      console.log(JSON.stringify(await request(`/api/sessions/${sessionId}/rollback`, { method: "POST", body: JSON.stringify({ snapshotId }) }), null, 2));
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
