import { createHash } from "node:crypto";

export interface SnapshotEntry {
  path: string;
  contentHash: string;
  size: number;
}

export interface SnapshotManifest {
  version: 1;
  id: string;
  repositoryId: string;
  sessionId: string;
  createdAt: string;
  parentSnapshotId?: string;
  entries: SnapshotEntry[];
  digest: string;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
    .join(",")}}`;
}

export function sha256(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hashFile(content: string | Uint8Array): string {
  return sha256(content);
}

export function createSnapshot(input: {
  repositoryId: string;
  sessionId: string;
  entries: SnapshotEntry[];
  parentSnapshotId?: string;
  createdAt?: string;
}): SnapshotManifest {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const entries = [...input.entries].sort((a, b) => a.path.localeCompare(b.path));
  const canonical = {
    version: 1 as const,
    repositoryId: input.repositoryId,
    sessionId: input.sessionId,
    createdAt,
    parentSnapshotId: input.parentSnapshotId,
    entries,
  };
  const digest = sha256(stableJson(canonical));
  return {
    ...canonical,
    id: `snapshot_${digest.slice(0, 24)}`,
    digest,
  };
}

export function verifySnapshot(snapshot: SnapshotManifest): boolean {
  const { id: _id, digest, ...canonical } = snapshot;
  return sha256(stableJson(canonical)) === digest;
}
