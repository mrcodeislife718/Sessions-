import { getCheckpoint, getSourceManifest, listHistory, type CheckpointRecord, type SourceEntry } from "./core.js";

export interface PathHistoryRecord {
  path: string;
  kind: "added" | "modified" | "removed";
  checkpointId: string;
  parentCheckpointIds: string[];
  workstreamId: string;
  createdAt: string;
  actorIds: string[];
  sessionIds: string[];
  objective?: string;
  beforeDigest?: string;
  afterDigest?: string;
  beforeSize?: number;
  afterSize?: number;
}

function normalizeRepositoryPath(value: string): string {
  const normalized=value.replaceAll("\\","/").replace(/^\.\//,"");
  if (!normalized || normalized === "." || normalized.startsWith("/") || normalized.split("/").some(segment=>segment === "..")) throw new Error(`Invalid repository path: ${value}`);
  return normalized;
}

async function entryFor(root: string, checkpoint: CheckpointRecord | undefined, repositoryPath: string): Promise<SourceEntry | undefined> {
  if (!checkpoint) return undefined;
  const manifest=await getSourceManifest(root,checkpoint.sourceManifestId);
  return manifest.entries.find(entry=>entry.path===repositoryPath);
}

export async function pathHistory(root: string, value: string): Promise<PathHistoryRecord[]> {
  const repositoryPath=normalizeRepositoryPath(value);
  const history=await listHistory(root);
  const records:PathHistoryRecord[]=[];
  for (const checkpoint of history) {
    const parentId=checkpoint.parentCheckpointIds[0];
    const parent=parentId ? await getCheckpoint(root,parentId) : undefined;
    const currentEntry=await entryFor(root,checkpoint,repositoryPath);
    const parentEntry=await entryFor(root,parent,repositoryPath);
    if (!currentEntry && !parentEntry) continue;
    if (currentEntry?.digest===parentEntry?.digest && currentEntry?.size===parentEntry?.size) continue;
    const kind:PathHistoryRecord["kind"]=!parentEntry && currentEntry ? "added" : parentEntry && !currentEntry ? "removed" : "modified";
    records.push({
      path:repositoryPath,
      kind,
      checkpointId:checkpoint.id,
      parentCheckpointIds:[...checkpoint.parentCheckpointIds],
      workstreamId:checkpoint.workstreamId,
      createdAt:checkpoint.createdAt,
      actorIds:[...checkpoint.actorIds],
      sessionIds:[...checkpoint.sessionIds],
      objective:checkpoint.objective,
      beforeDigest:parentEntry?.digest,
      afterDigest:currentEntry?.digest,
      beforeSize:parentEntry?.size,
      afterSize:currentEntry?.size,
    });
  }
  return records.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
