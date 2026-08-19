import { createHash } from "node:crypto";
import type http from "node:http";
import type { Pool } from "pg";

export class RepositoryTransportError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

type Identity = { workspaceId: string; principalId: string; scopes: string[]; localDevelopment?: boolean };
type Context = { pool: Pool; identity: Identity; req: http.IncomingMessage; url: URL; body: () => Promise<any>; send: (status: number, body: unknown) => void };
const metadataMax = Number(process.env.SESSIONS_REPOSITORY_METADATA_BYTES ?? 16 * 1024 * 1024);
const objectMax = Number(process.env.SESSIONS_REPOSITORY_OBJECT_BYTES ?? 128 * 1024 * 1024);

function requireScope(identity: Identity, scope: string) { if (!identity.localDevelopment && !identity.scopes.includes("*") && !identity.scopes.includes(scope)) throw new RepositoryTransportError(403, `missing scope: ${scope}`); }
function sha256(content: Buffer) { return createHash("sha256").update(content).digest("hex"); }
function safeName(value: unknown, field: string) { if (typeof value !== "string" || !value.trim() || value.length > 200) throw new RepositoryTransportError(400, `${field} is required`); return value.trim(); }
async function readRaw(req: http.IncomingMessage, max: number) { const chunks: Buffer[]=[]; let size=0; for await(const chunk of req){const value=Buffer.from(chunk);size+=value.length;if(size>max)throw new RepositoryTransportError(413,"repository transfer payload too large");chunks.push(value);} return Buffer.concat(chunks); }
async function readJson(req: http.IncomingMessage, max=metadataMax) { const raw=await readRaw(req,max); try{return raw.length?JSON.parse(raw.toString("utf8")):{};}catch{throw new RepositoryTransportError(400,"invalid repository JSON payload");} }
async function assertWritable(pool: Pool, workspaceId: string) { const result=await pool.query("select status from workspace_entitlements where workspace_id=$1",[workspaceId]);const status=result.rows[0]?.status;if(["payment_failed","canceled","suspended","pending_payment"].includes(status))throw new RepositoryTransportError(402,"workspace writes require an active paid entitlement"); }
async function ownedRepository(pool: Pool, workspaceId: string, repositoryId: string) { const result=await pool.query("select * from hosted_repositories where id=$1 and workspace_id=$2",[repositoryId,workspaceId]);if(!result.rowCount)throw new RepositoryTransportError(404,"repository not found");return result.rows[0]; }

async function repositoryState(pool: Pool, repositoryId: string) {
  const [state,refs,checkpoints,manifests,objects]=await Promise.all([
    pool.query("select state from sessions_repository_states where repository_id=$1",[repositoryId]),
    pool.query("select ref_type,name,checkpoint_id,metadata from sessions_repository_refs where repository_id=$1 order by ref_type,name",[repositoryId]),
    pool.query("select record from sessions_repository_checkpoints where repository_id=$1 order by created_at",[repositoryId]),
    pool.query("select manifest from repository_manifests where repository_id=$1 order by created_at",[repositoryId]),
    pool.query("select object_id,digest,size_bytes from sessions_repository_objects where repository_id=$1 order by object_id",[repositoryId]),
  ]);
  return { state:state.rows[0]?.state??null, refs:refs.rows, checkpoints:checkpoints.rows.map(r=>r.record), manifests:manifests.rows.map(r=>r.manifest), objects:objects.rows.map(r=>({objectId:r.object_id,digest:r.digest,size:Number(r.size_bytes)})) };
}

export async function handleRepositories(context: Context): Promise<boolean> {
  const { pool,identity,req,url,send }=context;
  if(url.pathname==="/api/repositories"&&req.method==="GET"){requireScope(identity,"sessions:read");const result=await pool.query("select * from hosted_repositories where workspace_id=$1 order by updated_at desc",[identity.workspaceId]);send(200,result.rows);return true;}
  if(url.pathname==="/api/repositories"&&req.method==="POST"){requireScope(identity,"sessions:write");await assertWritable(pool,identity.workspaceId);const input=await context.body();const id=safeName(input.id,"repository id"),name=safeName(input.name,"repository name"),visibility=input.visibility==="public"?"public":"private";const result=await pool.query(`insert into hosted_repositories(id,workspace_id,name,visibility,default_workstream_id,source_digest,created_at,updated_at) values($1,$2,$3,$4,$5,$6,now(),now()) on conflict(id) do update set name=excluded.name,visibility=excluded.visibility,default_workstream_id=excluded.default_workstream_id,source_digest=excluded.source_digest,updated_at=now() where hosted_repositories.workspace_id=excluded.workspace_id returning *`,[id,identity.workspaceId,name,visibility,input.defaultBranchId??null,input.sourceDigest??null]);if(!result.rowCount)throw new RepositoryTransportError(409,"repository id belongs to another workspace");await pool.query("insert into product_events(id,workspace_id,principal_id,event_name,repository_id,properties) values('product_'||gen_random_uuid()::text,$1,$2,'repository_created',$3,$4)",[identity.workspaceId,identity.principalId,id,JSON.stringify({transport:"sessions-native"})]);send(201,result.rows[0]);return true;}

  let match=url.pathname.match(/^\/api\/repositories\/([^/]+)$/);
  if(match&&req.method==="GET"){requireScope(identity,"sessions:read");send(200,await ownedRepository(pool,identity.workspaceId,decodeURIComponent(match[1])));return true;}

  match=url.pathname.match(/^\/api\/repositories\/([^/]+)\/state$/);
  if(match){const repositoryId=decodeURIComponent(match[1]);const repository=await ownedRepository(pool,identity.workspaceId,repositoryId);
    if(req.method==="GET"){requireScope(identity,"sessions:read");send(200,{version:1,protocol:"sessions-native",repository,...await repositoryState(pool,repositoryId)});return true;}
    if(req.method==="POST"){requireScope(identity,"sessions:write");await assertWritable(pool,identity.workspaceId);const input=await readJson(req);if(input.protocol!=="sessions-native"||input.version!==1)throw new RepositoryTransportError(400,"unsupported Sessions repository protocol");const client=await pool.connect();try{await client.query("begin");await client.query("delete from sessions_repository_refs where repository_id=$1",[repositoryId]);for(const ref of input.refs??[])await client.query("insert into sessions_repository_refs(repository_id,ref_type,name,checkpoint_id,metadata) values($1,$2,$3,$4,$5)",[repositoryId,ref.refType??ref.ref_type,ref.name,ref.checkpointId??ref.checkpoint_id??null,JSON.stringify(ref.metadata??{})]);for(const checkpoint of input.checkpoints??[])await client.query("insert into sessions_repository_checkpoints(repository_id,checkpoint_id,record) values($1,$2,$3) on conflict(repository_id,checkpoint_id) do update set record=excluded.record",[repositoryId,checkpoint.id,JSON.stringify(checkpoint)]);for(const manifest of input.manifests??[])await client.query("insert into repository_manifests(id,repository_id,source_digest,manifest) values($1,$2,$3,$4) on conflict(id) do update set source_digest=excluded.source_digest,manifest=excluded.manifest",[manifest.id,repositoryId,manifest.sourceDigest,JSON.stringify(manifest)]);await client.query("insert into sessions_repository_states(repository_id,state,updated_at) values($1,$2,now()) on conflict(repository_id) do update set state=excluded.state,updated_at=now()",[repositoryId,JSON.stringify(input.state??{})]);await client.query("update hosted_repositories set source_digest=$2,updated_at=now() where id=$1",[repositoryId,input.sourceDigest??null]);await client.query("commit");}catch(error){await client.query("rollback");throw error;}finally{client.release();}send(200,{ok:true,protocol:"sessions-native",repositoryId});return true;}
  }

  match=url.pathname.match(/^\/api\/repositories\/([^/]+)\/objects\/plan$/);
  if(match&&req.method==="POST"){requireScope(identity,"sessions:write");await assertWritable(pool,identity.workspaceId);const repositoryId=decodeURIComponent(match[1]);await ownedRepository(pool,identity.workspaceId,repositoryId);const input=await readJson(req,4*1024*1024);const objects=Array.isArray(input.objects)?input.objects:[];if(objects.length>5000)throw new RepositoryTransportError(400,"object plan batch exceeds 5000 entries");const ids=objects.map((x:any)=>String(x.objectId));const existing=ids.length?await pool.query("select object_id,digest,size_bytes from sessions_repository_objects where repository_id=$1 and object_id=any($2::text[])",[repositoryId,ids]):{rows:[]};const present=new Map(existing.rows.map((r:any)=>[r.object_id,r]));const missing:string[]=[];for(const object of objects){const prior=present.get(String(object.objectId));if(!prior){missing.push(String(object.objectId));continue;}if(prior.digest!==object.digest||Number(prior.size_bytes)!==Number(object.size))throw new RepositoryTransportError(409,`object identity collision: ${object.objectId}`);}send(200,{missing});return true;}

  match=url.pathname.match(/^\/api\/repositories\/([^/]+)\/objects\/([^/]+)$/);
  if(match){const repositoryId=decodeURIComponent(match[1]),objectId=decodeURIComponent(match[2]);await ownedRepository(pool,identity.workspaceId,repositoryId);
    if(req.method==="GET"){requireScope(identity,"sessions:read");const result=await pool.query("select digest,size_bytes,encode(content,'base64') content_base64 from sessions_repository_objects where repository_id=$1 and object_id=$2",[repositoryId,objectId]);if(!result.rowCount)throw new RepositoryTransportError(404,"object not found");const row=result.rows[0];send(200,{objectId,digest:row.digest,size:Number(row.size_bytes),contentBase64:row.content_base64});return true;}
    if(req.method==="POST"){requireScope(identity,"sessions:write");await assertWritable(pool,identity.workspaceId);const expectedDigest=url.searchParams.get("digest")??"",expectedSize=Number(url.searchParams.get("size")??"-1");const content=await readRaw(req,objectMax),actualDigest=sha256(content);if(actualDigest!==expectedDigest||content.length!==expectedSize)throw new RepositoryTransportError(400,"Sessions object integrity verification failed");await pool.query("insert into sessions_repository_objects(repository_id,object_id,digest,size_bytes,content) values($1,$2,$3,$4,$5) on conflict(repository_id,object_id) do nothing",[repositoryId,objectId,actualDigest,content.length,content]);send(201,{ok:true,objectId,digest:actualDigest,size:content.length});return true;}
  }

  return false;
}
