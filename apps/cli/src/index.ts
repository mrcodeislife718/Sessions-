#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const [, , command, ...args] = process.argv;
const api = process.env.SESSIONS_API_URL ?? "http://localhost:4000";
const stateDir = join(process.cwd(), ".sessions");
const stateFile = join(stateDir, "state.json");
const ignored = new Set([".git", ".sessions", "node_modules", ".next", "dist", "coverage"]);

type LocalState = { sessionId?: string; repositoryId?: string };
type SnapshotEntry = { path: string; contentHash: string; size: number };

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
async function captureTree(root: string, dir = root): Promise<SnapshotEntry[]> {
  const entries: SnapshotEntry[] = [];
  for (const name of await readdir(dir)) {
    if (ignored.has(name)) continue;
    const absolute = join(dir, name);
    const info = await stat(absolute);
    if (info.isDirectory()) entries.push(...await captureTree(root, absolute));
    else if (info.isFile()) {
      const content = await readFile(absolute);
      entries.push({ path: relative(root, absolute).replaceAll("\\", "/"), contentHash: createHash("sha256").update(content).digest("hex"), size: info.size });
    }
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

const help = `Sessions CLI\n\nCommands:\n  init [repository-id]\n  start <objective>\n  record <EventType> [message]\n  checkpoint\n  verify <kind> <passed|failed|requires_review> <summary>\n  timeline\n  replay\n  rollback <snapshot-id>\n  status\n`;

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
    case "record": {
      const sessionId = requireSession(state);
      const [type, ...message] = args;
      if (!type) throw new Error("Usage: sessions record <EventType> [message]");
      console.log(JSON.stringify(await request(`/api/sessions/${sessionId}/events`, { method: "POST", body: JSON.stringify({ type, payload: { message: message.join(" ") } }) }), null, 2));
      return;
    }
    case "checkpoint": {
      const sessionId = requireSession(state);
      const entries = await captureTree(process.cwd());
      const snapshot = await request(`/api/sessions/${sessionId}/snapshots`, { method: "POST", body: JSON.stringify({ entries }) });
      console.log(`${snapshot.id}\n${entries.length} files captured\n${snapshot.digest}`);
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
    default: console.log(help);
  }
}

main().catch((error) => {
  console.error(`Sessions: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
