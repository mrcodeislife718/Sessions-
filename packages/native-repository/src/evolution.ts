import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  checkoutWorkstream,
  createCheckpoint,
  getActiveWorkstream,
  getCheckpoint,
  integrateWorkstream,
  openRepository,
  previewIntegration,
  repositoryStatus,
  restoreCheckpoint,
  type CheckpointLifecycle,
  type CheckpointRecord,
  type IntegrationPreview,
  type SourceChange,
} from "./core.js";

export interface ChangeRecord {
  version: 1;
  id: string;
  repositoryId: string;
  title: string;
  checkpointIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RepositoryOperation {
  version: 1;
  id: string;
  type: "commit" | "integrate" | "restore" | "checkout" | "undo" | "resolve-conflict";
  repositoryId: string;
  actorIds: string[];
  before: { workstreamId: string; headCheckpointId?: string; sourceDigest: string; clean: boolean };
  after: { workstreamId: string; headCheckpointId?: string; sourceDigest: string; clean: boolean };
  relatedChangeId?: string;
  relatedConflictId?: string;
  relatedCheckpointIds: string[];
  undoneOperationId?: string;
  createdAt: string;
}

export interface ConflictRecord {
  version: 1;
  id: string;
  repositoryId: string;
  sourceWorkstreamId: string;
  targetWorkstreamId: string;
  baseCheckpointId?: string;
  sourceCheckpointId?: string;
  targetCheckpointId?: string;
  conflicts: Array<{ path: string; source: SourceChange; target: SourceChange }>;
  status: "unresolved" | "resolved" | "superseded";
  createdAt: string;
  resolvedAt?: string;
  resolutionCheckpointId?: string;
  resolutionOperationId?: string;
}

const internal = (root: string) => ({
  changes: join(root, ".sessions", "changes"),
  operations: join(root, ".sessions", "operations"),
  conflicts: join(root, ".sessions", "conflicts"),
});

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await import("node:fs/promises").then(({ rename }) => rename(temp, path));
}
async function readJson<T>(path: string): Promise<T> { return JSON.parse(await readFile(path, "utf8")) as T; }
function id(prefix: string, value: unknown): string { return `${prefix}_${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24)}`; }

async function snapshot(root: string) {
  const status = await repositoryStatus(root);
  return {
    workstreamId: status.workstream.id,
    headCheckpointId: status.workstream.headCheckpointId,
    sourceDigest: status.currentSourceDigest,
    clean: status.clean,
  };
}

async function appendOperation(root: string, input: Omit<RepositoryOperation, "version" | "id" | "repositoryId" | "createdAt">): Promise<RepositoryOperation> {
  const repository = await openRepository(root);
  const createdAt = new Date().toISOString();
  const material = { ...input, repositoryId: repository.id, createdAt, nonce: randomUUID() };
  const operation: RepositoryOperation = { version: 1, id: id("op", material), repositoryId: repository.id, ...input, createdAt };
  await writeJson(join(internal(root).operations, `${operation.id}.json`), operation);
  return operation;
}

export async function listOperations(root: string): Promise<RepositoryOperation[]> {
  try {
    const files = await readdir(internal(root).operations);
    const records = await Promise.all(files.filter(name => name.endsWith(".json")).map(name => readJson<RepositoryOperation>(join(internal(root).operations, name))));
    return records.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  } catch { return []; }
}

export async function getChange(root: string, changeId: string): Promise<ChangeRecord> { return readJson<ChangeRecord>(join(internal(root).changes, `${changeId}.json`)); }

async function recordChange(root: string, checkpoint: CheckpointRecord, { changeId, title }: { changeId?: string; title: string }): Promise<ChangeRecord> {
  const repository = await openRepository(root);
  const now = new Date().toISOString();
  let record: ChangeRecord;
  if (changeId) {
    record = await getChange(root, changeId);
    if (record.repositoryId !== repository.id) throw new Error("change identity belongs to another repository");
    if (!record.checkpointIds.includes(checkpoint.id)) record.checkpointIds.push(checkpoint.id);
    record.title = title || record.title;
    record.updatedAt = now;
  } else {
    const newId = id("change", { repositoryId: repository.id, checkpointId: checkpoint.id, nonce: randomUUID() });
    record = { version:1, id:newId, repositoryId:repository.id, title, checkpointIds:[checkpoint.id], createdAt:now, updatedAt:now };
  }
  await writeJson(join(internal(root).changes, `${record.id}.json`), record);
  return record;
}

export async function commitChange(root: string, input: { friendlyName: string; changeId?: string; actorIds?: string[]; sessionIds?: string[]; objective?: string; lifecycle?: CheckpointLifecycle; allIfNothingStaged?: boolean }): Promise<{ checkpoint: CheckpointRecord; change: ChangeRecord; operation: RepositoryOperation }> {
  const before = await snapshot(root);
  const checkpoint = await createCheckpoint(root, input);
  const change = await recordChange(root, checkpoint, { changeId: input.changeId, title: input.friendlyName });
  const after = await snapshot(root);
  const operation = await appendOperation(root, { type:"commit", actorIds:[...(input.actorIds ?? [])], before, after, relatedChangeId:change.id, relatedCheckpointIds:[checkpoint.id] });
  return { checkpoint, change, operation };
}

async function persistConflict(root: string, preview: IntegrationPreview): Promise<ConflictRecord> {
  const repository = await openRepository(root);
  const createdAt = new Date().toISOString();
  const material = { repositoryId:repository.id, source:preview.source.id, target:preview.target.id, base:preview.baseCheckpointId, sourceCheckpointId:preview.sourceCheckpointId, targetCheckpointId:preview.targetCheckpointId, conflicts:preview.conflicts, createdAt };
  const record: ConflictRecord = {
    version:1, id:id("conflict",material), repositoryId:repository.id,
    sourceWorkstreamId:preview.source.id, targetWorkstreamId:preview.target.id,
    baseCheckpointId:preview.baseCheckpointId, sourceCheckpointId:preview.sourceCheckpointId, targetCheckpointId:preview.targetCheckpointId,
    conflicts:preview.conflicts, status:"unresolved", createdAt,
  };
  await writeJson(join(internal(root).conflicts, `${record.id}.json`), record);
  return record;
}

export async function listConflicts(root: string, status?: ConflictRecord["status"]): Promise<ConflictRecord[]> {
  try {
    const files = await readdir(internal(root).conflicts);
    const records = await Promise.all(files.filter(name=>name.endsWith(".json")).map(name=>readJson<ConflictRecord>(join(internal(root).conflicts,name))));
    return records.filter(record=>!status || record.status===status).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  } catch { return []; }
}

export async function integrateChange(root: string, sourceReference: string, actorIds: string[] = []): Promise<{ checkpoint?: CheckpointRecord; preview: IntegrationPreview; operation?: RepositoryOperation; conflict?: ConflictRecord }> {
  const before = await snapshot(root);
  const preview = await previewIntegration(root, sourceReference);
  if (!preview.canIntegrate) return { preview, conflict: await persistConflict(root, preview) };
  const result = await integrateWorkstream(root, sourceReference);
  const after = await snapshot(root);
  const operation = await appendOperation(root, { type:"integrate", actorIds, before, after, relatedCheckpointIds: result.checkpoint ? [result.checkpoint.id] : [] });
  return { ...result, operation };
}

export async function resolveConflict(root: string, conflictId: string, resolutionCheckpointId: string, actorIds: string[] = []): Promise<ConflictRecord> {
  const path = join(internal(root).conflicts, `${conflictId}.json`);
  const record = await readJson<ConflictRecord>(path);
  if (record.status !== "unresolved") throw new Error(`Conflict is not unresolved: ${conflictId}`);
  const resolutionCheckpoint = await getCheckpoint(root, resolutionCheckpointId);
  const before = await snapshot(root);
  const operation = await appendOperation(root, {
    type:"resolve-conflict",
    actorIds:[...actorIds],
    before,
    after:before,
    relatedConflictId:record.id,
    relatedCheckpointIds:[resolutionCheckpoint.id],
  });
  record.status = "resolved";
  record.resolvedAt = new Date().toISOString();
  record.resolutionCheckpointId = resolutionCheckpoint.id;
  record.resolutionOperationId = operation.id;
  await writeJson(path, record);
  return record;
}

export async function restoreWithOperation(root: string, checkpointReference: string, actorIds: string[] = []) {
  const before = await snapshot(root);
  const restored = await restoreCheckpoint(root, checkpointReference);
  const after = await snapshot(root);
  const operation = await appendOperation(root, { type:"restore", actorIds, before, after, relatedCheckpointIds:[restored.restored.id, ...(restored.protectionCheckpoint ? [restored.protectionCheckpoint.id] : [])] });
  return { ...restored, operation };
}

export async function checkoutWithOperation(root: string, workstreamReference: string, actorIds: string[] = []) {
  const before = await snapshot(root);
  const workstream = await checkoutWorkstream(root, workstreamReference);
  const after = await snapshot(root);
  const operation = await appendOperation(root, { type:"checkout", actorIds, before, after, relatedCheckpointIds: workstream.headCheckpointId ? [workstream.headCheckpointId] : [] });
  return { workstream, operation };
}

export async function undoOperation(root: string, operationId: string, actorIds: string[] = []): Promise<{ undone: RepositoryOperation; operation: RepositoryOperation }> {
  const operations = await listOperations(root);
  const target = operations.find(item => item.id === operationId);
  if (!target) throw new Error(`Unknown repository operation: ${operationId}`);
  const current = await snapshot(root);
  if (!current.clean) throw new Error("Cannot undo repository operation with uncommitted changes");
  if (target.before.workstreamId !== current.workstreamId) await checkoutWorkstream(root, target.before.workstreamId);
  if (target.before.headCheckpointId) await restoreCheckpoint(root, target.before.headCheckpointId);
  else if (target.before.sourceDigest !== (await snapshot(root)).sourceDigest) throw new Error("Cannot reconstruct empty pre-operation state safely");
  const after = await snapshot(root);
  const operation = await appendOperation(root, { type:"undo", actorIds, before:current, after, relatedCheckpointIds:target.before.headCheckpointId ? [target.before.headCheckpointId] : [], undoneOperationId:target.id });
  return { undone:target, operation };
}
