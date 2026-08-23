import http from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";

const port = Number(process.env.REPOSITORY_PORT ?? 4300);
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://sessions:sessions@localhost:5432/sessions";
const maxBody = Number(process.env.SESSIONS_MAX_BODY_BYTES ?? 1_048_576);
const pool = new Pool({ connectionString: databaseUrl, max: Number(process.env.SESSIONS_REPOSITORY_DB_POOL_MAX ?? 10) });

class HttpError extends Error { constructor(public readonly status: number, message: string) { super(message); } }
type Identity = { workspaceId: string; principalId: string; scopes: string[] };

function send(res: http.ServerResponse, status: number, body: unknown) { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); }
function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }
function hasScope(identity: Identity, scope: string) { return identity.scopes.includes("*") || identity.scopes.includes(scope); }
function requireScope(identity: Identity, scope: string) { if (!hasScope(identity, scope)) throw new HttpError(403, `missing scope: ${scope}`); }

async function jsonBody(req: http.IncomingMessage) {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { const buffer = Buffer.from(chunk); size += buffer.length; if (size > maxBody) throw new HttpError(413, "request body too large"); chunks.push(buffer); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new HttpError(400, "invalid JSON body"); }
}

async function authenticate(req: http.IncomingMessage): Promise<Identity> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) throw new HttpError(401, "bearer token required");
  const result = await pool.query(`select c.workspace_id,c.principal_id,c.scopes from api_credentials c join principals p on p.id=c.principal_id where c.token_hash=$1 and c.status='active' and p.status='active' and (c.expires_at is null or c.expires_at>now())`, [hashToken(auth.slice(7).trim())]);
  if (!result.rowCount) throw new HttpError(401, "invalid or expired credential");
  return { workspaceId: result.rows[0].workspace_id, principalId: result.rows[0].principal_id, scopes: result.rows[0].scopes ?? [] };
}

async function requireActiveEntitlement(identity: Identity) {
  const result = await pool.query("select status from workspace_entitlements where workspace_id=$1", [identity.workspaceId]);
  const status = result.rows[0]?.status;
  if (status !== "active") throw new HttpError(402, "activate a paid Sessions plan before adding hosted repositories");
}

async function upsertRepository(identity: Identity, body: any) {
  requireScope(identity, "sessions:write"); await requireActiveEntitlement(identity);
  const id = String(body.repositoryId ?? "").trim(), name = String(body.name ?? "").trim();
  if (!/^repo_[A-Za-z0-9._:-]+$/.test(id)) throw new HttpError(400, "valid Sessions repositoryId is required");
  if (name.length < 1 || name.length > 200) throw new HttpError(400, "repository name is required");
  const visibility = body.visibility === "public" ? "public" : "private";
  const result = await pool.query(`insert into hosted_repositories(id,workspace_id,name,visibility,default_workstream_id,source_digest) values($1,$2,$3,$4,$5,$6) on conflict(id) do update set name=excluded.name,visibility=excluded.visibility,default_workstream_id=coalesce(excluded.default_workstream_id,hosted_repositories.default_workstream_id),source_digest=coalesce(excluded.source_digest,hosted_repositories.source_digest),updated_at=now() where hosted_repositories.workspace_id=excluded.workspace_id returning *`, [id, identity.workspaceId, name, visibility, body.defaultWorkstreamId ?? null, body.sourceDigest ?? null]);
  if (!result.rowCount) throw new HttpError(409, "repository identifier belongs to another workspace");
  await pool.query("insert into product_events(id,workspace_id,principal_id,event_name,repository_id,properties) values($1,$2,$3,'repository_registered',$4,$5)", [`product_${randomUUID()}`, identity.workspaceId, identity.principalId, id, JSON.stringify({ visibility })]);
  return result.rows[0];
}

async function ingestGitImport(identity: Identity, repositoryId: string, body: any) {
  requireScope(identity, "sessions:write"); await requireActiveEntitlement(identity);
  const repo = await pool.query("select id from hosted_repositories where id=$1 and workspace_id=$2", [repositoryId, identity.workspaceId]);
  if (!repo.rowCount) throw new HttpError(404, "repository not found");
  const commits = Array.isArray(body.commits) ? body.commits.slice(0, 100000) : [];
  const branches = Array.isArray(body.branches) ? body.branches.slice(0, 10000) : [];
  const tags = Array.isArray(body.tags) ? body.tags.slice(0, 10000) : [];
  const client = await pool.connect();
  try {
    await client.query("begin");
    const importId = `gitimport_${randomUUID()}`;
    await client.query("insert into repository_git_imports(id,workspace_id,repository_id,source_kind,source_url,commit_count,branch_count,tag_count) values($1,$2,$3,'git',$4,$5,$6,$7)", [importId, identity.workspaceId, repositoryId, body.sourceUrl ?? null, commits.length, branches.length, tags.length]);
    for (const item of commits) {
      if (!item?.gitSha || !item?.checkpointId) continue;
      await client.query("insert into repository_git_commits(repository_id,git_sha,sessions_checkpoint_id,subject,actor_ids,created_at) values($1,$2,$3,$4,$5,$6) on conflict(repository_id,git_sha) do update set sessions_checkpoint_id=excluded.sessions_checkpoint_id,subject=excluded.subject,actor_ids=excluded.actor_ids,created_at=excluded.created_at", [repositoryId, String(item.gitSha), String(item.checkpointId), item.subject ?? null, JSON.stringify(item.actorIds ?? []), item.createdAt ?? null]);
    }
    for (const [type, items] of [["branch", branches], ["tag", tags]] as const) for (const item of items) {
      if (!item?.name) continue;
      await client.query("insert into repository_git_refs(repository_id,ref_type,name,git_sha,sessions_checkpoint_id) values($1,$2,$3,$4,$5) on conflict(repository_id,ref_type,name) do update set git_sha=excluded.git_sha,sessions_checkpoint_id=excluded.sessions_checkpoint_id", [repositoryId, type, String(item.name), item.gitSha ?? null, item.checkpointId ?? null]);
    }
    await client.query("insert into product_events(id,workspace_id,principal_id,event_name,repository_id,properties) values($1,$2,$3,'git_repository_imported',$4,$5)", [`product_${randomUUID()}`, identity.workspaceId, identity.principalId, repositoryId, JSON.stringify({ commits: commits.length, branches: branches.length, tags: tags.length })]);
    await client.query("commit");
    return { importId, repositoryId, commits: commits.length, branches: branches.length, tags: tags.length };
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (req.method === "GET" && url.pathname === "/health") { await pool.query("select 1"); return send(res, 200, { ok: true, service: "sessions-repositories" }); }
    const identity = await authenticate(req);
    if (req.method === "GET" && url.pathname === "/api/repositories") { requireScope(identity, "sessions:read"); const result = await pool.query("select * from hosted_repositories where workspace_id=$1 order by updated_at desc", [identity.workspaceId]); return send(res, 200, result.rows); }
    if (req.method === "POST" && url.pathname === "/api/repositories") return send(res, 201, await upsertRepository(identity, await jsonBody(req)));
    const match = url.pathname.match(/^\/api\/repositories\/([^/]+)\/git-import$/);
    if (req.method === "POST" && match) return send(res, 201, await ingestGitImport(identity, decodeURIComponent(match[1]), await jsonBody(req)));
    throw new HttpError(404, "not found");
  } catch (error) { const status = error instanceof HttpError ? error.status : 500; const message = error instanceof Error ? error.message : "internal error"; return send(res, status, { error: status >= 500 ? "internal error" : message }); }
});

server.listen(port, "0.0.0.0", () => console.log(JSON.stringify({ level: "info", event: "repositories.started", port })));
async function shutdown() { server.close(async () => { await pool.end(); process.exit(0); }); setTimeout(() => process.exit(1), 10_000).unref(); }
process.on("SIGTERM", () => void shutdown()); process.on("SIGINT", () => void shutdown());
