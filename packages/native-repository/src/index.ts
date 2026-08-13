import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

export type CheckpointLifecycle = "draft" | "verified" | "reviewed" | "approved" | "published";

export interface RepositoryManifest {
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  defaultWorkstreamId: string;
}

export interface WorkstreamRecord {
  id: string;
  repositoryId: string;
  name: string;
  objective?: string;
  headCheckpointId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SourceEntry {
  path: string;
  digest: string;
  size: number;
}

export interface CheckpointRecord {
  id: string;
  friendlyName: string;
  repositoryId: string;
  workstreamId: string;
  parentCheckpointIds: string[];
  entries: SourceEntry[];
  sourceDigest: string;
  lifecycle: CheckpointLifecycle;
  objective?: string;
  actorIds: string[];
  createdAt: string;
}

export interface RepositoryState {
  activeWorkstreamId: string;
}

const INTERNAL_DIR = ".sessions";
const ignoredNames = new Set([INTERNAL_DIR, "node_modules", ".next", "dist", "coverage"]);

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
}

export function digest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function paths(root: string) {
  const base = join(root, INTERNAL_DIR);
  return {
    base,
    manifest: join(base, "repository.json"),
    state: join(base, "state.json"),
    workstreams: join(base, "workstreams"),
    checkpoints: join(base, "checkpoints"),
  };
}

export async function initializeRepository(root: string, name?: string): Promise<RepositoryManifest> {
  const p = paths(root);
  await mkdir(p.workstreams, { recursive: true });
  await mkdir(p.checkpoints, { recursive: true });

  const repositoryId = `repo_${randomUUID()}`;
  const workstreamId = `ws_${randomUUID()}`;
  const createdAt = new Date().toISOString();

  const manifest: RepositoryManifest = {
    version: 1,
    id: repositoryId,
    name: name ?? root.split(/[\\/]/).filter(Boolean).pop() ?? "repository",
    createdAt,
    defaultWorkstreamId: workstreamId,
  };

  const workstream: WorkstreamRecord = {
    id: workstreamId,
    repositoryId,
    name: "main",
    createdAt,
    updatedAt: createdAt,
  };

  await writeJson(p.manifest, manifest);
  await writeJson(join(p.workstreams, `${workstreamId}.json`), workstream);
  await writeJson(p.state, { activeWorkstreamId: workstreamId } satisfies RepositoryState);
  return manifest;
}

export async function openRepository(root: string): Promise<RepositoryManifest> {
  return readJson<RepositoryManifest>(paths(root).manifest);
}

export async function createWorkstream(root: string, input: { name: string; objective?: string; fromCheckpointId?: string }): Promise<WorkstreamRecord> {
  const manifest = await openRepository(root);
  const p = paths(root);
  const now = new Date().toISOString();
  const record: WorkstreamRecord = {
    id: `ws_${randomUUID()}`,
    repositoryId: manifest.id,
    name: input.name,
    objective: input.objective,
    headCheckpointId: input.fromCheckpointId,
    createdAt: now,
    updatedAt: now,
  };
  await writeJson(join(p.workstreams, `${record.id}.json`), record);
  return record;
}

export async function listWorkstreams(root: string): Promise<WorkstreamRecord[]> {
  const p = paths(root);
  const files = await readdir(p.workstreams);
  return Promise.all(files.filter((name) => name.endsWith(".json")).map((name) => readJson<WorkstreamRecord>(join(p.workstreams, name))));
}

export async function switchWorkstream(root: string, workstreamId: string): Promise<void> {
  const p = paths(root);
  await readJson<WorkstreamRecord>(join(p.workstreams, `${workstreamId}.json`));
  await writeJson(p.state, { activeWorkstreamId: workstreamId } satisfies RepositoryState);
}

export async function getActiveWorkstream(root: string): Promise<WorkstreamRecord> {
  const p = paths(root);
  const state = await readJson<RepositoryState>(p.state);
  return readJson<WorkstreamRecord>(join(p.workstreams, `${state.activeWorkstreamId}.json`));
}

export async function scanSource(root: string, dir = root): Promise<SourceEntry[]> {
  const entries: SourceEntry[] = [];
  for (const name of await readdir(dir)) {
    if (ignoredNames.has(name) || (name.startsWith(".") && name !== ".env.example")) continue;
    const absolute = join(dir, name);
    const info = await stat(absolute);
    if (info.isDirectory()) entries.push(...await scanSource(root, absolute));
    if (info.isFile()) {
      const content = await readFile(absolute);
      entries.push({ path: relative(root, absolute).replaceAll("\\", "/"), digest: digest(content), size: info.size });
    }
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

export function sourceDigest(entries: SourceEntry[]): string {
  return digest(stableJson([...entries].sort((a, b) => a.path.localeCompare(b.path))));
}

export async function createCheckpoint(root: string, input: { friendlyName: string; actorIds?: string[]; objective?: string; lifecycle?: CheckpointLifecycle }): Promise<CheckpointRecord> {
  const manifest = await openRepository(root);
  const p = paths(root);
  const workstream = await getActiveWorkstream(root);
  const entries = await scanSource(root);
  const createdAt = new Date().toISOString();
  const material = {
    repositoryId: manifest.id,
    workstreamId: workstream.id,
    parentCheckpointIds: workstream.headCheckpointId ? [workstream.headCheckpointId] : [],
    entries,
    createdAt,
  };
  const checkpoint: CheckpointRecord = {
    id: `cp_${digest(stableJson(material)).slice(0, 24)}`,
    friendlyName: input.friendlyName,
    repositoryId: manifest.id,
    workstreamId: workstream.id,
    parentCheckpointIds: material.parentCheckpointIds,
    entries,
    sourceDigest: sourceDigest(entries),
    lifecycle: input.lifecycle ?? "draft",
    objective: input.objective ?? workstream.objective,
    actorIds: input.actorIds ?? [],
    createdAt,
  };
  await writeJson(join(p.checkpoints, `${checkpoint.id}.json`), checkpoint);
  await writeJson(join(p.workstreams, `${workstream.id}.json`), { ...workstream, headCheckpointId: checkpoint.id, updatedAt: createdAt });
  return checkpoint;
}

export async function listHistory(root: string): Promise<CheckpointRecord[]> {
  const p = paths(root);
  const files = await readdir(p.checkpoints);
  const records = await Promise.all(files.filter((name) => name.endsWith(".json")).map((name) => readJson<CheckpointRecord>(join(p.checkpoints, name))));
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function repositoryStatus(root: string) {
  const workstream = await getActiveWorkstream(root);
  const currentEntries = await scanSource(root);
  const currentDigest = sourceDigest(currentEntries);
  let head: CheckpointRecord | undefined;
  if (workstream.headCheckpointId) head = await readJson<CheckpointRecord>(join(paths(root).checkpoints, `${workstream.headCheckpointId}.json`));
  return {
    workstream,
    headCheckpoint: head,
    currentSourceDigest: currentDigest,
    clean: head ? head.sourceDigest === currentDigest : currentEntries.length === 0,
  };
}
