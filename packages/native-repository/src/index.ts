import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

export type CheckpointLifecycle = "draft" | "verified" | "reviewed" | "approved" | "published";
export type ChangeKind = "added" | "modified" | "removed";

export interface RepositoryManifest {
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  defaultWorkstreamId: string;
  hashAlgorithm: "sha256";
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
  objectId: string;
  size: number;
}

export interface SourceManifest {
  version: 1;
  id: string;
  repositoryId: string;
  entries: SourceEntry[];
  sourceDigest: string;
}

export interface CheckpointRecord {
  version: 1;
  id: string;
  friendlyName: string;
  repositoryId: string;
  workstreamId: string;
  parentCheckpointIds: string[];
  sourceManifestId: string;
  sourceDigest: string;
  lifecycle: CheckpointLifecycle;
  objective?: string;
  actorIds: string[];
  sessionIds: string[];
  verificationIds: string[];
  approvalIds: string[];
  recovery: {
    reconstructable: boolean;
    verified: boolean;
  };
  createdAt: string;
}

export interface RepositoryState {
  activeWorkstreamId: string;
}

export interface SourceChange {
  path: string;
  kind: ChangeKind;
  beforeDigest?: string;
  afterDigest?: string;
  beforeSize?: number;
  afterSize?: number;
}

export interface RestorePreview {
  checkpoint: CheckpointRecord;
  changes: SourceChange[];
  dirty: boolean;
  willAdd: number;
  willModify: number;
  willRemove: number;
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
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function paths(root: string) {
  const base = join(root, INTERNAL_DIR);
  return {
    base,
    manifest: join(base, "repository.json"),
    state: join(base, "state.json"),
    workstreams: join(base, "refs", "workstreams"),
    checkpoints: join(base, "checkpoints"),
    blobs: join(base, "objects", "blobs"),
    manifests: join(base, "objects", "manifests"),
    sessions: join(base, "sessions"),
    evidence: join(base, "evidence"),
    reviews: join(base, "reviews"),
    temp: join(base, "tmp"),
    index: join(base, "index"),
    cache: join(base, "cache"),
  };
}

function objectPath(root: string, objectId: string): string {
  const p = paths(root);
  const hash = objectId.replace(/^obj_/, "");
  return join(p.blobs, hash.slice(0, 2), hash.slice(2));
}

async function persistBlob(root: string, content: Uint8Array): Promise<{ objectId: string; digest: string }> {
  const hash = digest(content);
  const objectId = `obj_${hash}`;
  const target = objectPath(root, objectId);
  try {
    await stat(target);
  } catch {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return { objectId, digest: hash };
}

export async function initializeRepository(root: string, name?: string): Promise<RepositoryManifest> {
  const p = paths(root);
  for (const directory of [p.workstreams, p.checkpoints, p.blobs, p.manifests, p.sessions, p.evidence, p.reviews, p.temp, p.index, p.cache]) {
    await mkdir(directory, { recursive: true });
  }

  try {
    return await readJson<RepositoryManifest>(p.manifest);
  } catch {
    // First initialization continues below.
  }

  const repositoryId = `repo_${randomUUID()}`;
  const workstreamId = `ws_${randomUUID()}`;
  const createdAt = new Date().toISOString();
  const manifest: RepositoryManifest = {
    version: 1,
    id: repositoryId,
    name: name ?? root.split(/[\\/]/).filter(Boolean).pop() ?? "repository",
    createdAt,
    defaultWorkstreamId: workstreamId,
    hashAlgorithm: "sha256",
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
  const existing = (await listWorkstreams(root)).find((item) => item.name === input.name);
  if (existing) throw new Error(`Workstream already exists: ${input.name}`);
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
  const items = await Promise.all(files.filter((name) => name.endsWith(".json")).map((name) => readJson<WorkstreamRecord>(join(p.workstreams, name))));
  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function resolveWorkstream(root: string, reference: string): Promise<WorkstreamRecord> {
  const items = await listWorkstreams(root);
  const exact = items.find((item) => item.id === reference || item.name === reference);
  if (!exact) throw new Error(`Unknown Workstream: ${reference}`);
  return exact;
}

export async function switchWorkstream(root: string, reference: string): Promise<WorkstreamRecord> {
  const record = await resolveWorkstream(root, reference);
  await writeJson(paths(root).state, { activeWorkstreamId: record.id } satisfies RepositoryState);
  return record;
}

export async function getActiveWorkstream(root: string): Promise<WorkstreamRecord> {
  const p = paths(root);
  const state = await readJson<RepositoryState>(p.state);
  return readJson<WorkstreamRecord>(join(p.workstreams, `${state.activeWorkstreamId}.json`));
}

export async function scanSource(root: string, dir = root, persistObjects = false): Promise<SourceEntry[]> {
  const entries: SourceEntry[] = [];
  for (const name of await readdir(dir)) {
    if (ignoredNames.has(name) || (name.startsWith(".") && name !== ".env.example")) continue;
    const absolute = join(dir, name);
    const info = await stat(absolute);
    if (info.isDirectory()) {
      entries.push(...await scanSource(root, absolute, persistObjects));
    } else if (info.isFile()) {
      const content = await readFile(absolute);
      const hashed = persistObjects ? await persistBlob(root, content) : { objectId: `obj_${digest(content)}`, digest: digest(content) };
      entries.push({ path: relative(root, absolute).replaceAll("\\", "/"), digest: hashed.digest, objectId: hashed.objectId, size: info.size });
    }
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

export function sourceDigest(entries: SourceEntry[]): string {
  return digest(stableJson(entries.map(({ path, digest: hash, size }) => ({ path, digest: hash, size })).sort((a, b) => a.path.localeCompare(b.path))));
}

async function persistSourceManifest(root: string, repositoryId: string, entries: SourceEntry[]): Promise<SourceManifest> {
  const canonical = { version: 1 as const, repositoryId, entries, sourceDigest: sourceDigest(entries) };
  const id = `manifest_${digest(stableJson(canonical))}`;
  const manifest: SourceManifest = { ...canonical, id };
  await writeJson(join(paths(root).manifests, `${id}.json`), manifest);
  return manifest;
}

export async function getSourceManifest(root: string, id: string): Promise<SourceManifest> {
  return readJson<SourceManifest>(join(paths(root).manifests, `${id}.json`));
}

export async function getCheckpoint(root: string, reference: string): Promise<CheckpointRecord> {
  const history = await listHistory(root);
  const matches = history.filter((item) => item.id === reference || item.friendlyName === reference);
  if (matches.length === 0) throw new Error(`Unknown Checkpoint: ${reference}`);
  if (matches.length > 1 && !matches.some((item) => item.id === reference)) throw new Error(`Checkpoint name is ambiguous: ${reference}`);
  return matches.find((item) => item.id === reference) ?? matches[0];
}

export async function createCheckpoint(root: string, input: {
  friendlyName: string;
  actorIds?: string[];
  sessionIds?: string[];
  objective?: string;
  lifecycle?: CheckpointLifecycle;
}): Promise<CheckpointRecord> {
  const manifest = await openRepository(root);
  const p = paths(root);
  const workstream = await getActiveWorkstream(root);
  const entries = await scanSource(root, root, true);
  const sourceManifest = await persistSourceManifest(root, manifest.id, entries);
  const createdAt = new Date().toISOString();
  const material = {
    version: 1 as const,
    repositoryId: manifest.id,
    workstreamId: workstream.id,
    parentCheckpointIds: workstream.headCheckpointId ? [workstream.headCheckpointId] : [],
    sourceManifestId: sourceManifest.id,
    sourceDigest: sourceManifest.sourceDigest,
    objective: input.objective ?? workstream.objective,
    actorIds: [...(input.actorIds ?? [])].sort(),
    sessionIds: [...(input.sessionIds ?? [])].sort(),
    createdAt,
  };
  const checkpoint: CheckpointRecord = {
    ...material,
    id: `cp_${digest(stableJson(material)).slice(0, 24)}`,
    friendlyName: input.friendlyName,
    lifecycle: input.lifecycle ?? "draft",
    verificationIds: [],
    approvalIds: [],
    recovery: { reconstructable: true, verified: true },
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

export function diffEntries(before: SourceEntry[], after: SourceEntry[]): SourceChange[] {
  const left = new Map(before.map((entry) => [entry.path, entry]));
  const right = new Map(after.map((entry) => [entry.path, entry]));
  const names = [...new Set([...left.keys(), ...right.keys()])].sort();
  const changes: SourceChange[] = [];
  for (const path of names) {
    const previous = left.get(path);
    const current = right.get(path);
    if (!previous && current) changes.push({ path, kind: "added", afterDigest: current.digest, afterSize: current.size });
    else if (previous && !current) changes.push({ path, kind: "removed", beforeDigest: previous.digest, beforeSize: previous.size });
    else if (previous && current && previous.digest !== current.digest) changes.push({ path, kind: "modified", beforeDigest: previous.digest, afterDigest: current.digest, beforeSize: previous.size, afterSize: current.size });
  }
  return changes;
}

export async function repositoryDiff(root: string): Promise<SourceChange[]> {
  const workstream = await getActiveWorkstream(root);
  const current = await scanSource(root);
  if (!workstream.headCheckpointId) return current.map((entry) => ({ path: entry.path, kind: "added" as const, afterDigest: entry.digest, afterSize: entry.size }));
  const head = await getCheckpoint(root, workstream.headCheckpointId);
  const manifest = await getSourceManifest(root, head.sourceManifestId);
  return diffEntries(manifest.entries, current);
}

export async function repositoryStatus(root: string) {
  const repository = await openRepository(root);
  const workstream = await getActiveWorkstream(root);
  const currentEntries = await scanSource(root);
  const currentSourceDigest = sourceDigest(currentEntries);
  const head = workstream.headCheckpointId ? await getCheckpoint(root, workstream.headCheckpointId) : undefined;
  const changes = head ? await repositoryDiff(root) : currentEntries.map((entry) => ({ path: entry.path, kind: "added" as const }));
  return {
    repository: { id: repository.id, name: repository.name },
    workstream,
    headCheckpoint: head,
    currentSourceDigest,
    clean: changes.length === 0,
    changes,
  };
}

async function reconstructCheckpoint(root: string, checkpoint: CheckpointRecord, destination: string): Promise<SourceEntry[]> {
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  const manifest = await getSourceManifest(root, checkpoint.sourceManifestId);
  for (const entry of manifest.entries) {
    const content = await readFile(objectPath(root, entry.objectId));
    if (digest(content) !== entry.digest) throw new Error(`Corrupt source object for ${entry.path}`);
    const target = join(destination, entry.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  const reconstructed = await scanSource(destination);
  if (sourceDigest(reconstructed) !== checkpoint.sourceDigest) throw new Error(`Reconstruction integrity failure for ${checkpoint.id}`);
  return reconstructed;
}

export async function previewRestore(root: string, reference: string): Promise<RestorePreview> {
  const checkpoint = await getCheckpoint(root, reference);
  const manifest = await getSourceManifest(root, checkpoint.sourceManifestId);
  const current = await scanSource(root);
  const changes = diffEntries(current, manifest.entries);
  return {
    checkpoint,
    changes,
    dirty: (await repositoryDiff(root)).length > 0,
    willAdd: changes.filter((item) => item.kind === "added").length,
    willModify: changes.filter((item) => item.kind === "modified").length,
    willRemove: changes.filter((item) => item.kind === "removed").length,
  };
}

export async function restoreCheckpoint(root: string, reference: string): Promise<{ restored: CheckpointRecord; protectionCheckpoint?: CheckpointRecord; changes: SourceChange[] }> {
  const preview = await previewRestore(root, reference);
  let protectionCheckpoint: CheckpointRecord | undefined;
  if (preview.dirty) {
    protectionCheckpoint = await createCheckpoint(root, {
      friendlyName: `auto-before-restore-${new Date().toISOString().replace(/[:.]/g, "-")}`,
      lifecycle: "draft",
    });
  }

  const temp = join(paths(root).temp, `restore-${randomUUID()}`);
  await reconstructCheckpoint(root, preview.checkpoint, temp);
  const targetManifest = await getSourceManifest(root, preview.checkpoint.sourceManifestId);
  const current = await scanSource(root);
  const targetPaths = new Set(targetManifest.entries.map((entry) => entry.path));
  for (const entry of current) {
    if (!targetPaths.has(entry.path)) await rm(join(root, entry.path), { force: true });
  }
  for (const entry of targetManifest.entries) {
    const content = await readFile(join(temp, entry.path));
    const target = join(root, entry.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  const finalEntries = await scanSource(root);
  if (sourceDigest(finalEntries) !== preview.checkpoint.sourceDigest) throw new Error("Post-restore integrity verification failed");
  await rm(temp, { recursive: true, force: true });

  const workstream = await getActiveWorkstream(root);
  await writeJson(join(paths(root).workstreams, `${workstream.id}.json`), {
    ...workstream,
    headCheckpointId: preview.checkpoint.id,
    updatedAt: new Date().toISOString(),
  });
  return { restored: preview.checkpoint, protectionCheckpoint, changes: preview.changes };
}
