import { createHash } from "node:crypto";
import type http from "node:http";
import type { Pool } from "pg";

export class RepositoryTransportError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

type Identity = { workspaceId: string; principalId: string; scopes: string[]; localDevelopment?: boolean };
type Context = {
  pool: Pool;
  identity: Identity;
  req: http.IncomingMessage;
  url: URL;
  body: () => Promise<any>;
  send: (status: number, body: unknown) => void;
};

function requireScope(identity: Identity, scope: string) {
  if (!identity.localDevelopment && !identity.scopes.includes("*") && !identity.scopes.includes(scope)) throw new RepositoryTransportError(403, `missing scope: ${scope}`);
}
function sha256(content: Buffer) { return createHash("sha256").update(content).digest("hex"); }
function safeName(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim() || value.length > 200) throw new RepositoryTransportError(400, `${field} is required`);
  return value.trim();
}
async function assertWritable(pool: Pool, workspaceId: string) {
  const result = await pool.query("select status from workspace_entitlements where workspace_id=$1", [workspaceId]);
  const status = result.rows[0]?.status;
  if (["payment_failed", "canceled", "suspended", "pending_payment"].includes(status)) throw new RepositoryTransportError(402, "workspace writes require an active paid entitlement");
}
async function ownedRepository(pool: Pool, workspaceId: string, repositoryId: string) {
  const result = await pool.query("select * from hosted_repositories where id=$1 and workspace_id=$2", [repositoryId, workspaceId]);
  if (!result.rowCount) throw new RepositoryTransportError(404, "repository not found");
  return result.rows[0];
}

export async function handleRepositories(context: Context): Promise<boolean> {
  const { pool, identity, req, url, send } = context;

  if (url.pathname === "/api/repositories" && req.method === "GET") {
    requireScope(identity, "sessions:read");
    const result = await pool.query("select * from hosted_repositories where workspace_id=$1 order by updated_at desc", [identity.workspaceId]);
    send(200, result.rows); return true;
  }

  if (url.pathname === "/api/repositories" && req.method === "POST") {
    requireScope(identity, "sessions:write"); await assertWritable(pool, identity.workspaceId);
    const input = await context.body();
    const id = safeName(input.id, "repository id");
    const name = safeName(input.name, "repository name");
    const visibility = input.visibility === "public" ? "public" : "private";
    const result = await pool.query(
      `insert into hosted_repositories(id,workspace_id,name,visibility,default_workstream_id,source_digest,created_at,updated_at)
       values($1,$2,$3,$4,$5,$6,now(),now())
       on conflict(id) do update set name=excluded.name,visibility=excluded.visibility,default_workstream_id=excluded.default_workstream_id,source_digest=excluded.source_digest,updated_at=now()
       where hosted_repositories.workspace_id=excluded.workspace_id returning *`,
      [id, identity.workspaceId, name, visibility, input.defaultBranchId ?? null, input.sourceDigest ?? null],
    );
    if (!result.rowCount) throw new RepositoryTransportError(409, "repository id belongs to another workspace");
    await pool.query("insert into product_events(id,workspace_id,principal_id,event_name,repository_id,properties) values('product_'||gen_random_uuid()::text,$1,$2,'repository_created',$3,$4)", [identity.workspaceId, identity.principalId, id, JSON.stringify({ transport: "sessions-native" })]);
    send(201, result.rows[0]); return true;
  }

  const match = url.pathname.match(/^\/api\/repositories\/([^/]+)(?:\/(bundle))?$/);
  if (!match) return false;
  const repositoryId = decodeURIComponent(match[1]);
  const action = match[2];

  if (!action && req.method === "GET") {
    requireScope(identity, "sessions:read");
    send(200, await ownedRepository(pool, identity.workspaceId, repositoryId)); return true;
  }

  if (action === "bundle" && req.method === "GET") {
    requireScope(identity, "sessions:read");
    const repository = await ownedRepository(pool, identity.workspaceId, repositoryId);
    const [state, refs, checkpoints, manifests, objects] = await Promise.all([
      pool.query("select state from sessions_repository_states where repository_id=$1", [repositoryId]),
      pool.query("select ref_type,name,checkpoint_id,metadata from sessions_repository_refs where repository_id=$1 order by ref_type,name", [repositoryId]),
      pool.query("select record from sessions_repository_checkpoints where repository_id=$1 order by created_at", [repositoryId]),
      pool.query("select manifest from repository_manifests where repository_id=$1 order by created_at", [repositoryId]),
      pool.query("select object_id,digest,size_bytes,encode(content,'base64') as content_base64 from sessions_repository_objects where repository_id=$1", [repositoryId]),
    ]);
    send(200, { version: 1, protocol: "sessions-native", repository, state: state.rows[0]?.state ?? null, refs: refs.rows, checkpoints: checkpoints.rows.map(r=>r.record), manifests: manifests.rows.map(r=>r.manifest), objects: objects.rows.map(r=>({ objectId:r.object_id,digest:r.digest,size:r.size_bytes,contentBase64:r.content_base64 })) });
    return true;
  }

  if (action === "bundle" && req.method === "POST") {
    requireScope(identity, "sessions:write"); await assertWritable(pool, identity.workspaceId);
    await ownedRepository(pool, identity.workspaceId, repositoryId);
    const input = await context.body();
    if (input.protocol !== "sessions-native" || input.version !== 1) throw new RepositoryTransportError(400, "unsupported Sessions repository protocol");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("delete from sessions_repository_refs where repository_id=$1", [repositoryId]);
      for (const ref of input.refs ?? []) await client.query("insert into sessions_repository_refs(repository_id,ref_type,name,checkpoint_id,metadata) values($1,$2,$3,$4,$5)", [repositoryId, ref.refType ?? ref.ref_type, ref.name, ref.checkpointId ?? ref.checkpoint_id ?? null, JSON.stringify(ref.metadata ?? {})]);
      for (const checkpoint of input.checkpoints ?? []) await client.query("insert into sessions_repository_checkpoints(repository_id,checkpoint_id,record) values($1,$2,$3) on conflict(repository_id,checkpoint_id) do update set record=excluded.record", [repositoryId, checkpoint.id, JSON.stringify(checkpoint)]);
      for (const manifest of input.manifests ?? []) await client.query("insert into repository_manifests(id,repository_id,source_digest,manifest) values($1,$2,$3,$4) on conflict(id) do update set source_digest=excluded.source_digest,manifest=excluded.manifest", [manifest.id, repositoryId, manifest.sourceDigest, JSON.stringify(manifest)]);
      for (const object of input.objects ?? []) {
        const content = Buffer.from(object.contentBase64 ?? "", "base64");
        const digest = sha256(content);
        if (digest !== object.digest || content.byteLength !== Number(object.size)) throw new RepositoryTransportError(400, `object integrity failed: ${object.objectId}`);
        await client.query("insert into sessions_repository_objects(repository_id,object_id,digest,size_bytes,content) values($1,$2,$3,$4,$5) on conflict(repository_id,object_id) do nothing", [repositoryId, object.objectId, digest, content.byteLength, content]);
      }
      await client.query("insert into sessions_repository_states(repository_id,state,updated_at) values($1,$2,now()) on conflict(repository_id) do update set state=excluded.state,updated_at=now()", [repositoryId, JSON.stringify(input.state ?? {})]);
      await client.query("update hosted_repositories set source_digest=$2,updated_at=now() where id=$1", [repositoryId, input.sourceDigest ?? null]);
      await client.query("commit");
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
    send(200, { ok: true, protocol: "sessions-native", repositoryId }); return true;
  }

  return false;
}
