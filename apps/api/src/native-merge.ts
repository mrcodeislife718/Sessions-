import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

export class NativeMergeConflictError extends Error {
  constructor(public readonly conflicts: string[]) {
    super(`native merge has ${conflicts.length} conflict(s): ${conflicts.join(", ")}`);
  }
}

type Entry={path:string;digest:string;objectId:string;size:number};
type Checkpoint={id:string;parentCheckpointIds?:string[];sourceManifestId:string;sourceDigest:string};

function stableJson(value:unknown):string{
  if(value===null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(stableJson).join(",")}]`;
  const object=value as Record<string,unknown>;
  return `{${Object.keys(object).sort().map(key=>`${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
}
function digest(value:string|Uint8Array){return createHash("sha256").update(value).digest("hex");}
function sourceDigest(entries:Entry[]){return digest(stableJson(entries.map(({path,digest:hash,size})=>({path,digest:hash,size})).sort((a,b)=>a.path.localeCompare(b.path))));}
function changedPaths(base:Entry[],next:Entry[]){const left=new Map(base.map(entry=>[entry.path,entry]));const right=new Map(next.map(entry=>[entry.path,entry]));const paths=new Set<string>();for(const path of new Set([...left.keys(),...right.keys()])){const a=left.get(path),b=right.get(path);if(!a||!b||a.digest!==b.digest)paths.add(path);}return paths;}
async function checkpointMap(client:PoolClient,repositoryId:string){const rows=await client.query("select checkpoint_id,record from sessions_repository_checkpoints where repository_id=$1",[repositoryId]);return new Map<string,Checkpoint>(rows.rows.map(row=>[String(row.checkpoint_id),row.record as Checkpoint]));}
function ancestorSet(checkpoints:Map<string,Checkpoint>,start:string){const seen=new Set<string>(),queue=[start];while(queue.length){const id=queue.shift()!;if(seen.has(id))continue;seen.add(id);for(const parent of checkpoints.get(id)?.parentCheckpointIds??[])queue.push(parent);}return seen;}
function commonAncestor(checkpoints:Map<string,Checkpoint>,targetId:string,sourceId:string){const targetAncestors=ancestorSet(checkpoints,targetId),seen=new Set<string>(),queue=[sourceId];while(queue.length){const id=queue.shift()!;if(seen.has(id))continue;seen.add(id);if(targetAncestors.has(id))return id;for(const parent of checkpoints.get(id)?.parentCheckpointIds??[])queue.push(parent);}return undefined;}
async function entriesFor(client:PoolClient,repositoryId:string,checkpoint:Checkpoint|undefined):Promise<Entry[]>{if(!checkpoint)return[];const result=await client.query("select manifest from repository_manifests where repository_id=$1 and id=$2",[repositoryId,checkpoint.sourceManifestId]);if(!result.rowCount)throw new Error(`native merge manifest missing: ${checkpoint.sourceManifestId}`);return [...((result.rows[0].manifest?.entries??[]) as Entry[])].sort((a,b)=>a.path.localeCompare(b.path));}

export async function createNativeMergeCommit(client:PoolClient,input:{repositoryId:string;targetCommitId:string;sourceCommitId:string;targetWorkstreamId:string;targetBranch:string;sourceBranch:string;actorId:string}){
  const checkpoints=await checkpointMap(client,input.repositoryId);
  const target=checkpoints.get(input.targetCommitId),source=checkpoints.get(input.sourceCommitId);
  if(!target||!source)throw new Error("native merge requires existing target and source commits");
  const baseId=commonAncestor(checkpoints,input.targetCommitId,input.sourceCommitId);
  const base=baseId?checkpoints.get(baseId):undefined;
  const [baseEntries,targetEntries,sourceEntries]=await Promise.all([entriesFor(client,input.repositoryId,base),entriesFor(client,input.repositoryId,target),entriesFor(client,input.repositoryId,source)]);
  const targetChanges=changedPaths(baseEntries,targetEntries),sourceChanges=changedPaths(baseEntries,sourceEntries);
  const conflicts=[...sourceChanges].filter(path=>targetChanges.has(path)).sort();
  if(conflicts.length)throw new NativeMergeConflictError(conflicts);

  const merged=new Map(targetEntries.map(entry=>[entry.path,entry]));
  const sourceMap=new Map(sourceEntries.map(entry=>[entry.path,entry]));
  const baseMap=new Map(baseEntries.map(entry=>[entry.path,entry]));
  for(const path of sourceChanges){const next=sourceMap.get(path),prior=baseMap.get(path);if(!next&&prior)merged.delete(path);else if(next)merged.set(path,next);}
  const entries=[...merged.values()].sort((a,b)=>a.path.localeCompare(b.path));
  if(entries.length){const objectIds=entries.map(entry=>entry.objectId);const objects=await client.query("select object_id,digest,size_bytes from sessions_repository_objects where repository_id=$1 and object_id=any($2::text[])",[input.repositoryId,objectIds]);const byId=new Map(objects.rows.map(row=>[String(row.object_id),row]));for(const entry of entries){const object=byId.get(entry.objectId);if(!object||object.digest!==entry.digest||Number(object.size_bytes)!==Number(entry.size))throw new Error(`native merge object integrity unavailable: ${entry.path}`);}}

  const treeDigest=sourceDigest(entries);
  const canonical={version:1 as const,repositoryId:input.repositoryId,entries,sourceDigest:treeDigest};
  const manifestId=`manifest_${digest(stableJson(canonical))}`;
  const manifest={...canonical,id:manifestId};
  await client.query("insert into repository_manifests(id,repository_id,source_digest,manifest) values($1,$2,$3,$4) on conflict(id) do update set source_digest=excluded.source_digest,manifest=excluded.manifest",[manifestId,input.repositoryId,treeDigest,JSON.stringify(manifest)]);

  const createdAt=new Date().toISOString();
  const material={version:1 as const,repositoryId:input.repositoryId,workstreamId:input.targetWorkstreamId,parentCheckpointIds:[input.targetCommitId,input.sourceCommitId],sourceManifestId:manifestId,sourceDigest:treeDigest,objective:`Merge ${input.sourceBranch} into ${input.targetBranch}`,actorIds:[input.actorId],sessionIds:[],createdAt};
  const checkpointId=`cp_${digest(stableJson(material)).slice(0,24)}`;
  const checkpoint={...material,id:checkpointId,friendlyName:`merge-${input.sourceBranch}-into-${input.targetBranch}`,lifecycle:"verified",verificationIds:[],approvalIds:[],recovery:{reconstructable:true,verified:true}};
  await client.query("insert into sessions_repository_checkpoints(repository_id,checkpoint_id,record) values($1,$2,$3) on conflict(repository_id,checkpoint_id) do update set record=excluded.record",[input.repositoryId,checkpointId,JSON.stringify(checkpoint)]);
  return{checkpointId,manifestId,sourceDigest:treeDigest,baseCheckpointId:baseId,conflicts:[] as string[],entries:entries.length};
}
