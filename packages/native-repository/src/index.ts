import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

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
  recovery: { reconstructable: boolean; verified: boolean };
  createdAt: string;
}

export interface RepositoryState { activeWorkstreamId: string; }

export interface SourceChange {
  path: string;
  kind: ChangeKind;
  beforeDigest?: string;
  afterDigest?: string;
  beforeSize?: number;
  afterSize?: number;
}

export interface StagedRecord {
  path: string;
  operation: "upsert" | "remove";
  entry?: SourceEntry;
  stagedAt: string;
}

export interface StageIndex { version: 1; entries: StagedRecord[]; }

export interface RestorePreview {
  checkpoint: CheckpointRecord;
  changes: SourceChange[];
  dirty: boolean;
  willAdd: number;
  willModify: number;
  willRemove: number;
}

export interface IntegrationPreview {
  source: WorkstreamRecord;
  target: WorkstreamRecord;
  baseCheckpointId?: string;
  sourceCheckpointId?: string;
  targetCheckpointId?: string;
  incomingChanges: SourceChange[];
  targetChanges: SourceChange[];
  conflicts: Array<{ path: string; source: SourceChange; target: SourceChange }>;
  fastForward: boolean;
  canIntegrate: boolean;
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

async function readJson<T>(path: string): Promise<T> { return JSON.parse(await readFile(path, "utf8")) as T; }
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
    stage: join(base, "index", "stage.json"),
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

function normalizePath(root: string, input: string): string {
  const absolute = resolve(root, input);
  const rel = relative(root, absolute).replaceAll("\\", "/");
  if (!rel || rel === ".") return ".";
  if (rel.startsWith("../") || rel === "..") throw new Error(`Path is outside repository: ${input}`);
  if (rel === INTERNAL_DIR || rel.startsWith(`${INTERNAL_DIR}/`)) throw new Error("Sessions internal state cannot be staged");
  return rel;
}

function objectPath(root: string, objectId: string): string {
  const hash = objectId.replace(/^obj_/, "");
  return join(paths(root).blobs, hash.slice(0, 2), hash.slice(2));
}

async function persistBlob(root: string, content: Uint8Array): Promise<{ objectId: string; digest: string }> {
  const hash = digest(content);
  const objectId = `obj_${hash}`;
  const target = objectPath(root, objectId);
  try { await stat(target); } catch {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return { objectId, digest: hash };
}

async function readStage(root: string): Promise<StageIndex> {
  try { return await readJson<StageIndex>(paths(root).stage); } catch { return { version: 1, entries: [] }; }
}
async function writeStage(root: string, entries: StagedRecord[]): Promise<void> {
  await writeJson(paths(root).stage, { version: 1, entries: [...entries].sort((a, b) => a.path.localeCompare(b.path)) } satisfies StageIndex);
}

export async function initializeRepository(root: string, name?: string): Promise<RepositoryManifest> {
  const p = paths(root);
  for (const directory of [p.workstreams, p.checkpoints, p.blobs, p.manifests, p.sessions, p.evidence, p.reviews, p.temp, p.index, p.cache]) await mkdir(directory, { recursive: true });
  try { return await readJson<RepositoryManifest>(p.manifest); } catch { /* first initialization */ }

  const repositoryId = `repo_${randomUUID()}`;
  const workstreamId = `ws_${randomUUID()}`;
  const createdAt = new Date().toISOString();
  const manifest: RepositoryManifest = { version: 1, id: repositoryId, name: name ?? root.split(/[\\/]/).filter(Boolean).pop() ?? "repository", createdAt, defaultWorkstreamId: workstreamId, hashAlgorithm: "sha256" };
  const workstream: WorkstreamRecord = { id: workstreamId, repositoryId, name: "main", createdAt, updatedAt: createdAt };
  await writeJson(p.manifest, manifest);
  await writeJson(join(p.workstreams, `${workstreamId}.json`), workstream);
  await writeJson(p.state, { activeWorkstreamId: workstreamId } satisfies RepositoryState);
  await writeStage(root, []);
  return manifest;
}

export async function openRepository(root: string): Promise<RepositoryManifest> { return readJson<RepositoryManifest>(paths(root).manifest); }

export async function createWorkstream(root: string, input: { name: string; objective?: string; fromCheckpointId?: string }): Promise<WorkstreamRecord> {
  const manifest = await openRepository(root);
  const existing = (await listWorkstreams(root)).find((item) => item.name === input.name);
  if (existing) throw new Error(`Workstream already exists: ${input.name}`);
  const now = new Date().toISOString();
  const record: WorkstreamRecord = { id: `ws_${randomUUID()}`, repositoryId: manifest.id, name: input.name, objective: input.objective, headCheckpointId: input.fromCheckpointId, createdAt: now, updatedAt: now };
  await writeJson(join(paths(root).workstreams, `${record.id}.json`), record);
  return record;
}

export async function listWorkstreams(root: string): Promise<WorkstreamRecord[]> {
  const files = await readdir(paths(root).workstreams);
  const items = await Promise.all(files.filter((name) => name.endsWith(".json")).map((name) => readJson<WorkstreamRecord>(join(paths(root).workstreams, name))));
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
  const state = await readJson<RepositoryState>(paths(root).state);
  return readJson<WorkstreamRecord>(join(paths(root).workstreams, `${state.activeWorkstreamId}.json`));
}

export async function scanSource(root: string, dir = root, persistObjects = false): Promise<SourceEntry[]> {
  const entries: SourceEntry[] = [];
  for (const name of await readdir(dir)) {
    if (ignoredNames.has(name) || (name.startsWith(".") && name !== ".env.example")) continue;
    const absolute = join(dir, name);
    const info = await stat(absolute);
    if (info.isDirectory()) entries.push(...await scanSource(root, absolute, persistObjects));
    else if (info.isFile()) {
      const content = await readFile(absolute);
      const hash = digest(content);
      const objectId = persistObjects ? (await persistBlob(root, content)).objectId : `obj_${hash}`;
      entries.push({ path: relative(root, absolute).replaceAll("\\", "/"), digest: hash, objectId, size: info.size });
    }
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

export function sourceDigest(entries: SourceEntry[]): string {
  return digest(stableJson(entries.map(({ path, digest: hash, size }) => ({ path, digest: hash, size })).sort((a, b) => a.path.localeCompare(b.path))));
}

async function persistSourceManifest(root: string, repositoryId: string, entries: SourceEntry[]): Promise<SourceManifest> {
  const canonical = { version: 1 as const, repositoryId, entries: [...entries].sort((a, b) => a.path.localeCompare(b.path)), sourceDigest: sourceDigest(entries) };
  const id = `manifest_${digest(stableJson(canonical))}`;
  const manifest: SourceManifest = { ...canonical, id };
  await writeJson(join(paths(root).manifests, `${id}.json`), manifest);
  return manifest;
}

export async function getSourceManifest(root: string, id: string): Promise<SourceManifest> { return readJson<SourceManifest>(join(paths(root).manifests, `${id}.json`)); }

export async function getCheckpoint(root: string, reference: string): Promise<CheckpointRecord> {
  const history = await listHistory(root);
  const matches = history.filter((item) => item.id === reference || item.friendlyName === reference);
  if (matches.length === 0) throw new Error(`Unknown Checkpoint: ${reference}`);
  if (matches.length > 1 && !matches.some((item) => item.id === reference)) throw new Error(`Checkpoint name is ambiguous: ${reference}`);
  return matches.find((item) => item.id === reference) ?? matches[0];
}

export async function listHistory(root: string): Promise<CheckpointRecord[]> {
  const files = await readdir(paths(root).checkpoints);
  const records = await Promise.all(files.filter((name) => name.endsWith(".json")).map((name) => readJson<CheckpointRecord>(join(paths(root).checkpoints, name))));
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function diffEntries(before: SourceEntry[], after: SourceEntry[]): SourceChange[] {
  const left = new Map(before.map((entry) => [entry.path, entry]));
  const right = new Map(after.map((entry) => [entry.path, entry]));
  const names = [...new Set([...left.keys(), ...right.keys()])].sort();
  const changes: SourceChange[] = [];
  for (const path of names) {
    const previous = left.get(path); const current = right.get(path);
    if (!previous && current) changes.push({ path, kind: "added", afterDigest: current.digest, afterSize: current.size });
    else if (previous && !current) changes.push({ path, kind: "removed", beforeDigest: previous.digest, beforeSize: previous.size });
    else if (previous && current && previous.digest !== current.digest) changes.push({ path, kind: "modified", beforeDigest: previous.digest, afterDigest: current.digest, beforeSize: previous.size, afterSize: current.size });
  }
  return changes;
}

async function headEntries(root: string, workstream = await getActiveWorkstream(root)): Promise<SourceEntry[]> {
  if (!workstream.headCheckpointId) return [];
  const checkpoint = await getCheckpoint(root, workstream.headCheckpointId);
  return (await getSourceManifest(root, checkpoint.sourceManifestId)).entries;
}

function applyStage(base: SourceEntry[], staged: StagedRecord[]): SourceEntry[] {
  const result = new Map(base.map((entry) => [entry.path, entry]));
  for (const record of staged) {
    if (record.operation === "remove") result.delete(record.path);
    else if (record.entry) result.set(record.path, record.entry);
  }
  return [...result.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export async function listStaged(root: string): Promise<StagedRecord[]> { return (await readStage(root)).entries; }

export async function stagePaths(root: string, inputs: string[]): Promise<StagedRecord[]> {
  await openRepository(root);
  const current = await scanSource(root);
  const currentMap = new Map(current.map((entry) => [entry.path, entry]));
  const baseline = await headEntries(root);
  const baselineMap = new Map(baseline.map((entry) => [entry.path, entry]));
  const stage = await readStage(root);
  const stagedMap = new Map(stage.entries.map((entry) => [entry.path, entry]));
  const normalized = inputs.length ? inputs.map((value) => normalizePath(root, value)) : ["."];
  const selects = (path: string) => normalized.some((selection) => selection === "." || path === selection || path.startsWith(`${selection}/`));
  const candidates = new Set([...currentMap.keys(), ...baselineMap.keys()].filter(selects));
  if (!candidates.size) throw new Error(`No matching changes for: ${inputs.join(", ") || "."}`);

  for (const path of candidates) {
    const currentEntry = currentMap.get(path);
    const baseEntry = baselineMap.get(path);
    if (currentEntry && baseEntry && currentEntry.digest === baseEntry.digest) { stagedMap.delete(path); continue; }
    if (!currentEntry && baseEntry) {
      stagedMap.set(path, { path, operation: "remove", stagedAt: new Date().toISOString() });
      continue;
    }
    if (currentEntry) {
      const content = await readFile(join(root, path));
      const persisted = await persistBlob(root, content);
      stagedMap.set(path, { path, operation: "upsert", entry: { ...currentEntry, objectId: persisted.objectId }, stagedAt: new Date().toISOString() });
    }
  }
  await writeStage(root, [...stagedMap.values()]);
  return (await readStage(root)).entries;
}

export async function unstagePaths(root: string, inputs: string[]): Promise<StagedRecord[]> {
  const stage = await readStage(root);
  if (!inputs.length || inputs.includes(".")) { await writeStage(root, []); return []; }
  const normalized = inputs.map((value) => normalizePath(root, value));
  const remaining = stage.entries.filter((entry) => !normalized.some((selection) => entry.path === selection || entry.path.startsWith(`${selection}/`)));
  await writeStage(root, remaining);
  return remaining;
}

export async function stagedDiff(root: string): Promise<SourceChange[]> {
  const base = await headEntries(root);
  const staged = applyStage(base, (await readStage(root)).entries);
  return diffEntries(base, staged);
}

export async function repositoryDiff(root: string): Promise<SourceChange[]> {
  const current = await scanSource(root);
  return diffEntries(await headEntries(root), current);
}

export async function unstagedDiff(root: string): Promise<SourceChange[]> {
  const stagedState = applyStage(await headEntries(root), (await readStage(root)).entries);
  return diffEntries(stagedState, await scanSource(root));
}

export async function repositoryStatus(root: string) {
  const repository = await openRepository(root);
  const workstream = await getActiveWorkstream(root);
  const currentEntries = await scanSource(root);
  const head = workstream.headCheckpointId ? await getCheckpoint(root, workstream.headCheckpointId) : undefined;
  const stagedChanges = await stagedDiff(root);
  const unstagedChanges = await unstagedDiff(root);
  return {
    repository: { id: repository.id, name: repository.name }, workstream, headCheckpoint: head,
    currentSourceDigest: sourceDigest(currentEntries), clean: stagedChanges.length === 0 && unstagedChanges.length === 0,
    stagedChanges, unstagedChanges, changes: await repositoryDiff(root),
  };
}

export async function createCheckpoint(root: string, input: { friendlyName: string; actorIds?: string[]; sessionIds?: string[]; objective?: string; lifecycle?: CheckpointLifecycle; allIfNothingStaged?: boolean }): Promise<CheckpointRecord> {
  const manifest = await openRepository(root);
  const workstream = await getActiveWorkstream(root);
  const stage = await readStage(root);
  let entries: SourceEntry[];
  if (stage.entries.length) entries = applyStage(await headEntries(root, workstream), stage.entries);
  else if (input.allIfNothingStaged !== false) entries = await scanSource(root, root, true);
  else throw new Error("Nothing staged. Use `sessions add <path>` or `sessions add .`");

  for (const entry of entries) {
    const target = objectPath(root, entry.objectId);
    try { await stat(target); } catch {
      const content = await readFile(join(root, entry.path));
      const persisted = await persistBlob(root, content);
      entry.objectId = persisted.objectId;
    }
  }
  const sourceManifest = await persistSourceManifest(root, manifest.id, entries);
  const createdAt = new Date().toISOString();
  const material = {
    version: 1 as const, repositoryId: manifest.id, workstreamId: workstream.id,
    parentCheckpointIds: workstream.headCheckpointId ? [workstream.headCheckpointId] : [],
    sourceManifestId: sourceManifest.id, sourceDigest: sourceManifest.sourceDigest,
    objective: input.objective ?? workstream.objective,
    actorIds: [...(input.actorIds ?? [])].sort(), sessionIds: [...(input.sessionIds ?? [])].sort(), createdAt,
  };
  const checkpoint: CheckpointRecord = {
    ...material, id: `cp_${digest(stableJson(material)).slice(0, 24)}`, friendlyName: input.friendlyName,
    lifecycle: input.lifecycle ?? "draft", verificationIds: [], approvalIds: [], recovery: { reconstructable: true, verified: true },
  };
  await writeJson(join(paths(root).checkpoints, `${checkpoint.id}.json`), checkpoint);
  await writeJson(join(paths(root).workstreams, `${workstream.id}.json`), { ...workstream, headCheckpointId: checkpoint.id, updatedAt: createdAt });
  await writeStage(root, []);
  return checkpoint;
}

async function reconstructCheckpoint(root: string, checkpoint: CheckpointRecord, destination: string): Promise<SourceEntry[]> {
  await rm(destination, { recursive: true, force: true }); await mkdir(destination, { recursive: true });
  const manifest = await getSourceManifest(root, checkpoint.sourceManifestId);
  for (const entry of manifest.entries) {
    const content = await readFile(objectPath(root, entry.objectId));
    if (digest(content) !== entry.digest) throw new Error(`Corrupt source object for ${entry.path}`);
    const target = join(destination, entry.path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, content);
  }
  const reconstructed = await scanSource(destination);
  if (sourceDigest(reconstructed) !== checkpoint.sourceDigest) throw new Error(`Reconstruction integrity failure for ${checkpoint.id}`);
  return reconstructed;
}

async function applyCheckpointToWorkingTree(root: string, checkpoint: CheckpointRecord): Promise<void> {
  const temp = join(paths(root).temp, `apply-${randomUUID()}`);
  await reconstructCheckpoint(root, checkpoint, temp);
  const manifest = await getSourceManifest(root, checkpoint.sourceManifestId);
  const current = await scanSource(root);
  const targetPaths = new Set(manifest.entries.map((entry) => entry.path));
  for (const entry of current) if (!targetPaths.has(entry.path)) await rm(join(root, entry.path), { force: true });
  for (const entry of manifest.entries) {
    const target = join(root, entry.path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, await readFile(join(temp, entry.path)));
  }
  await rm(temp, { recursive: true, force: true });
  if (sourceDigest(await scanSource(root)) !== checkpoint.sourceDigest) throw new Error("Working-tree integrity verification failed");
}

export async function checkoutWorkstream(root: string, reference: string): Promise<WorkstreamRecord> {
  const status = await repositoryStatus(root);
  if (!status.clean) throw new Error("Cannot switch Workstreams with staged or unstaged changes. Checkpoint, unstage, or restore them first.");
  const target = await resolveWorkstream(root, reference);
  if (target.headCheckpointId) await applyCheckpointToWorkingTree(root, await getCheckpoint(root, target.headCheckpointId));
  else {
    const current = await scanSource(root);
    for (const entry of current) await rm(join(root, entry.path), { force: true });
  }
  await writeStage(root, []);
  await writeJson(paths(root).state, { activeWorkstreamId: target.id } satisfies RepositoryState);
  return target;
}

export async function previewRestore(root: string, reference: string): Promise<RestorePreview> {
  const checkpoint = await getCheckpoint(root, reference);
  const manifest = await getSourceManifest(root, checkpoint.sourceManifestId);
  const current = await scanSource(root);
  const changes = diffEntries(current, manifest.entries);
  const status = await repositoryStatus(root);
  return { checkpoint, changes, dirty: !status.clean, willAdd: changes.filter((item) => item.kind === "added").length, willModify: changes.filter((item) => item.kind === "modified").length, willRemove: changes.filter((item) => item.kind === "removed").length };
}

export async function restoreCheckpoint(root: string, reference: string): Promise<{ restored: CheckpointRecord; protectionCheckpoint?: CheckpointRecord; changes: SourceChange[] }> {
  const preview = await previewRestore(root, reference);
  let protectionCheckpoint: CheckpointRecord | undefined;
  if (preview.dirty) protectionCheckpoint = await createCheckpoint(root, { friendlyName: `auto-before-restore-${new Date().toISOString().replace(/[:.]/g, "-")}`, lifecycle: "draft" });
  await applyCheckpointToWorkingTree(root, preview.checkpoint);
  await writeStage(root, []);
  const workstream = await getActiveWorkstream(root);
  await writeJson(join(paths(root).workstreams, `${workstream.id}.json`), { ...workstream, headCheckpointId: preview.checkpoint.id, updatedAt: new Date().toISOString() });
  return { restored: preview.checkpoint, protectionCheckpoint, changes: preview.changes };
}

async function ancestors(root: string, checkpointId?: string): Promise<Set<string>> {
  const seen = new Set<string>(); const queue = checkpointId ? [checkpointId] : [];
  while (queue.length) {
    const id = queue.shift()!; if (seen.has(id)) continue; seen.add(id);
    const checkpoint = await getCheckpoint(root, id); queue.push(...checkpoint.parentCheckpointIds);
  }
  return seen;
}

async function commonAncestor(root: string, a?: string, b?: string): Promise<string | undefined> {
  if (!a || !b) return undefined;
  const aAncestors = await ancestors(root, a);
  const queue = [b]; const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!; if (seen.has(id)) continue; seen.add(id);
    if (aAncestors.has(id)) return id;
    queue.push(...(await getCheckpoint(root, id)).parentCheckpointIds);
  }
  return undefined;
}

export async function previewIntegration(root: string, sourceReference: string, targetReference?: string): Promise<IntegrationPreview> {
  const source = await resolveWorkstream(root, sourceReference);
  const target = targetReference ? await resolveWorkstream(root, targetReference) : await getActiveWorkstream(root);
  if (source.id === target.id) throw new Error("Source and target Workstream are the same");
  const baseCheckpointId = await commonAncestor(root, source.headCheckpointId, target.headCheckpointId);
  const baseEntries = baseCheckpointId ? (await getSourceManifest(root, (await getCheckpoint(root, baseCheckpointId)).sourceManifestId)).entries : [];
  const sourceEntries = source.headCheckpointId ? (await getSourceManifest(root, (await getCheckpoint(root, source.headCheckpointId)).sourceManifestId)).entries : [];
  const targetEntries = target.headCheckpointId ? (await getSourceManifest(root, (await getCheckpoint(root, target.headCheckpointId)).sourceManifestId)).entries : [];
  const incomingChanges = diffEntries(baseEntries, sourceEntries);
  const targetChanges = diffEntries(baseEntries, targetEntries);
  const targetByPath = new Map(targetChanges.map((change) => [change.path, change]));
  const conflicts = incomingChanges.filter((change) => targetByPath.has(change.path)).map((sourceChange) => ({ path: sourceChange.path, source: sourceChange, target: targetByPath.get(sourceChange.path)! }));
  const fastForward = !!source.headCheckpointId && baseCheckpointId === target.headCheckpointId;
  return { source, target, baseCheckpointId, sourceCheckpointId: source.headCheckpointId, targetCheckpointId: target.headCheckpointId, incomingChanges, targetChanges, conflicts, fastForward, canIntegrate: conflicts.length === 0 };
}

export async function integrateWorkstream(root: string, sourceReference: string): Promise<{ checkpoint?: CheckpointRecord; preview: IntegrationPreview }> {
  const status = await repositoryStatus(root);
  if (!status.clean) throw new Error("Cannot integrate with staged or unstaged changes");
  const preview = await previewIntegration(root, sourceReference);
  if (!preview.canIntegrate) throw new Error(`Integration has ${preview.conflicts.length} conflict(s). Preview and resolve them before integrating.`);
  if (!preview.sourceCheckpointId) return { preview };
  if (preview.fastForward) {
    const checkpoint = await getCheckpoint(root, preview.sourceCheckpointId);
    await applyCheckpointToWorkingTree(root, checkpoint);
    await writeJson(join(paths(root).workstreams, `${preview.target.id}.json`), { ...preview.target, headCheckpointId: checkpoint.id, updatedAt: new Date().toISOString() });
    return { checkpoint, preview };
  }

  const baseEntries = preview.baseCheckpointId ? (await getSourceManifest(root, (await getCheckpoint(root, preview.baseCheckpointId)).sourceManifestId)).entries : [];
  const sourceEntries = (await getSourceManifest(root, (await getCheckpoint(root, preview.sourceCheckpointId)).sourceManifestId)).entries;
  const targetEntries = preview.targetCheckpointId ? (await getSourceManifest(root, (await getCheckpoint(root, preview.targetCheckpointId)).sourceManifestId)).entries : [];
  const merged = new Map(targetEntries.map((entry) => [entry.path, entry]));
  const sourceChanges = diffEntries(baseEntries, sourceEntries);
  const sourceMap = new Map(sourceEntries.map((entry) => [entry.path, entry]));
  for (const change of sourceChanges) {
    if (change.kind === "removed") merged.delete(change.path);
    else { const entry = sourceMap.get(change.path); if (entry) merged.set(change.path, entry); }
  }
  const repository = await openRepository(root);
  const manifest = await persistSourceManifest(root, repository.id, [...merged.values()]);
  const createdAt = new Date().toISOString();
  const material = { version: 1 as const, repositoryId: repository.id, workstreamId: preview.target.id, parentCheckpointIds: [preview.targetCheckpointId, preview.sourceCheckpointId].filter(Boolean) as string[], sourceManifestId: manifest.id, sourceDigest: manifest.sourceDigest, objective: preview.target.objective, actorIds: [], sessionIds: [], createdAt };
  const checkpoint: CheckpointRecord = { ...material, id: `cp_${digest(stableJson(material)).slice(0, 24)}`, friendlyName: `integrate-${preview.source.name}-into-${preview.target.name}`, lifecycle: "draft", verificationIds: [], approvalIds: [], recovery: { reconstructable: true, verified: true } };
  await writeJson(join(paths(root).checkpoints, `${checkpoint.id}.json`), checkpoint);
  await writeJson(join(paths(root).workstreams, `${preview.target.id}.json`), { ...preview.target, headCheckpointId: checkpoint.id, updatedAt: createdAt });
  await applyCheckpointToWorkingTree(root, checkpoint);
  return { checkpoint, preview };
}

export async function verifyRepositoryIntegrity(root: string): Promise<{ ok: boolean; checkedCheckpoints: number; checkedObjects: number; errors: string[] }> {
  const errors: string[] = []; const history = await listHistory(root); const checked = new Set<string>();
  for (const checkpoint of history) {
    try {
      const manifest = await getSourceManifest(root, checkpoint.sourceManifestId);
      if (manifest.sourceDigest !== checkpoint.sourceDigest || sourceDigest(manifest.entries) !== checkpoint.sourceDigest) errors.push(`Manifest digest mismatch: ${checkpoint.id}`);
      for (const entry of manifest.entries) {
        if (checked.has(entry.objectId)) continue; checked.add(entry.objectId);
        try { const content = await readFile(objectPath(root, entry.objectId)); if (digest(content) !== entry.digest) errors.push(`Object digest mismatch: ${entry.path} (${entry.objectId})`); }
        catch { errors.push(`Missing object: ${entry.objectId} for ${entry.path}`); }
      }
    } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  }
  return { ok: errors.length === 0, checkedCheckpoints: history.length, checkedObjects: checked.size, errors };
}
