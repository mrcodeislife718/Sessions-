import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  getCheckpoint,
  getSourceManifest,
  listHistory,
  listWorkstreams,
  openRepository,
  scanSource,
  sourceDigest,
  type CheckpointRecord,
  type SourceManifest,
} from "./core.js";
import { listTags } from "./transport.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd,
    env: { ...process.env, ...env },
    maxBuffer: 16 * 1024 * 1024,
  });
  return result.stdout.trim();
}

function objectPath(root: string, objectId: string): string {
  const hash = objectId.replace(/^obj_/, "");
  return join(root, ".sessions", "objects", "blobs", hash.slice(0, 2), hash.slice(2));
}

async function clearWorkingTree(root: string): Promise<void> {
  for (const entry of await readdir(root)) {
    if (entry === ".git") continue;
    await rm(join(root, entry), { recursive: true, force: true });
  }
}

async function materializeManifest(sourceRoot: string, destinationRoot: string, manifest: SourceManifest): Promise<void> {
  await clearWorkingTree(destinationRoot);
  for (const entry of manifest.entries) {
    const content = await readFile(objectPath(sourceRoot, entry.objectId));
    const target = join(destinationRoot, entry.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}

function parseActor(actor?: string): { name: string; email: string } {
  const match = actor?.match(/^(.+?)\s*<([^<>]+)>$/);
  if (match) return { name: match[1].trim(), email: match[2].trim() };
  return { name: actor?.trim() || "Sessions Export", email: "noreply@sessions.local" };
}

function orderedCheckpoints(records: CheckpointRecord[]): CheckpointRecord[] {
  const byId = new Map(records.map((record) => [record.id, record]));
  const pending = new Map(byId);
  const emitted = new Set<string>();
  const ordered: CheckpointRecord[] = [];

  while (pending.size) {
    let progressed = false;
    for (const [id, checkpoint] of [...pending]) {
      const parentsReady = checkpoint.parentCheckpointIds.every((parent) => !byId.has(parent) || emitted.has(parent));
      if (!parentsReady) continue;
      ordered.push(checkpoint);
      emitted.add(id);
      pending.delete(id);
      progressed = true;
    }
    if (!progressed) throw new Error("Sessions checkpoint graph is cyclic or references an unresolved parent");
  }

  return ordered;
}

export interface GitExportResult {
  sourceRepositoryId: string;
  destination: string;
  commits: number;
  branches: number;
  tags: number;
  defaultBranch: string;
  headSourceDigest?: string;
}

/**
 * Export a Sessions-native repository into an ordinary Git repository.
 *
 * The bridge is deliberately an adoption/migration boundary. Sessions-native
 * source control remains authoritative; Git is not used for native commits,
 * branches, remotes, verification, recovery, or synchronization.
 */
export async function exportGitRepository(source: string, destination: string): Promise<GitExportResult> {
  const sourceRoot = resolve(source);
  const destinationRoot = resolve(destination);
  const repository = await openRepository(sourceRoot);
  const workstreams = await listWorkstreams(sourceRoot);
  const history = await listHistory(sourceRoot);
  const tags = await listTags(sourceRoot);

  await rm(destinationRoot, { recursive: true, force: true });
  await mkdir(destinationRoot, { recursive: true });
  await git(destinationRoot, ["init", "--quiet"]);
  await git(destinationRoot, ["config", "user.name", "Sessions Export"]);
  await git(destinationRoot, ["config", "user.email", "noreply@sessions.local"]);

  const gitCommitByCheckpoint = new Map<string, string>();
  for (const checkpoint of orderedCheckpoints(history)) {
    const manifest = await getSourceManifest(sourceRoot, checkpoint.sourceManifestId);
    await materializeManifest(sourceRoot, destinationRoot, manifest);
    await git(destinationRoot, ["add", "-A"]);
    const tree = await git(destinationRoot, ["write-tree"]);
    const parentArgs = checkpoint.parentCheckpointIds.flatMap((parent) => {
      const mapped = gitCommitByCheckpoint.get(parent);
      return mapped ? ["-p", mapped] : [];
    });
    const actor = parseActor(checkpoint.actorIds[0]);
    const timestamp = checkpoint.createdAt || new Date(0).toISOString();
    const message = checkpoint.friendlyName || checkpoint.objective || `Sessions checkpoint ${checkpoint.id}`;
    const commit = await git(destinationRoot, ["commit-tree", tree, ...parentArgs, "-m", message], {
      GIT_AUTHOR_NAME: actor.name,
      GIT_AUTHOR_EMAIL: actor.email,
      GIT_COMMITTER_NAME: actor.name,
      GIT_COMMITTER_EMAIL: actor.email,
      GIT_AUTHOR_DATE: timestamp,
      GIT_COMMITTER_DATE: timestamp,
    });
    gitCommitByCheckpoint.set(checkpoint.id, commit);
  }

  for (const workstream of workstreams) {
    if (!workstream.headCheckpointId) continue;
    const commit = gitCommitByCheckpoint.get(workstream.headCheckpointId);
    if (!commit) throw new Error(`Cannot export Workstream ${workstream.name}: head checkpoint is unavailable`);
    await git(destinationRoot, ["check-ref-format", "--branch", workstream.name]);
    await git(destinationRoot, ["update-ref", `refs/heads/${workstream.name}`, commit]);
  }

  for (const tag of tags) {
    const commit = gitCommitByCheckpoint.get(tag.checkpointId);
    if (!commit) throw new Error(`Cannot export tag ${tag.name}: checkpoint is unavailable`);
    await git(destinationRoot, ["check-ref-format", `refs/tags/${tag.name}`]);
    await git(destinationRoot, ["update-ref", `refs/tags/${tag.name}`, commit]);
  }

  const defaultWorkstream = workstreams.find((item) => item.id === repository.defaultWorkstreamId) ?? workstreams[0];
  if (!defaultWorkstream?.headCheckpointId) throw new Error("Cannot export repository without a default Workstream head");
  await git(destinationRoot, ["symbolic-ref", "HEAD", `refs/heads/${defaultWorkstream.name}`]);
  await git(destinationRoot, ["checkout", "--quiet", "--force", defaultWorkstream.name]);

  const defaultCheckpoint = await getCheckpoint(sourceRoot, defaultWorkstream.headCheckpointId);
  const exportedDigest = sourceDigest(await scanSource(destinationRoot));
  if (exportedDigest !== defaultCheckpoint.sourceDigest) {
    throw new Error("Git export verification failed: exported default-branch source digest differs from Sessions source state");
  }

  return {
    sourceRepositoryId: repository.id,
    destination: destinationRoot,
    commits: gitCommitByCheckpoint.size,
    branches: workstreams.filter((item) => item.headCheckpointId).length,
    tags: tags.length,
    defaultBranch: defaultWorkstream.name,
    headSourceDigest: defaultCheckpoint.sourceDigest,
  };
}
