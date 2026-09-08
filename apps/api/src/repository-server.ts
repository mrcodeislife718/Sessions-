import http from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { handleReleaseGovernance } from "./release-governance.js";

const port = Number(process.env.REPOSITORY_PORT ?? 4300);
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://sessions:sessions@localhost:5432/sessions";
const maxBody = Number(process.env.SESSIONS_MAX_BODY_BYTES ?? 1_048_576);
const pool = new Pool({ connectionString: databaseUrl, max: Number(process.env.SESSIONS_REPOSITORY_DB_POOL_MAX ?? 10) });

class HttpError extends Error { constructor(public readonly status: number, message: string) { super(message); } }
type Identity = { workspaceId: string; principalId: string; scopes: string[] };

function send(res: http.ServerResponse, status: number, body: unknown) { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(status === 204 ? undefined : JSON.stringify(body)); }
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

async function requireRepository(identity: Identity, repositoryId: string) {
  const result = await pool.query("select * from hosted_repositories where id=$1 and workspace_id=$2", [repositoryId, identity.workspaceId]);
  if (!result.rowCount) throw new HttpError(404, "repository not found");
  return result.rows[0];
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
  requireScope(identity, "sessions:write"); await requireActiveEntitlement(identity); await requireRepository(identity, repositoryId);
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
    await pool.query("insert into product_events(id,workspace_id,principal_id,event_name,repository_id,properties) values($1,$2,$3,'git_repository_imported',$4,$5)", [`product_${randomUUID()}`, identity.workspaceId, identity.principalId, repositoryId, JSON.stringify({ commits: commits.length, branches: branches.length, tags: tags.length })]);
    await client.query("commit");
    return { importId, repositoryId, commits: commits.length, branches: branches.length, tags: tags.length };
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}

async function listBranchPolicies(identity: Identity, repositoryId: string) {
  requireScope(identity, "sessions:read"); await requireRepository(identity, repositoryId);
  const result = await pool.query("select * from repository_branch_policies where workspace_id=$1 and repository_id=$2 order by branch_name", [identity.workspaceId, repositoryId]);
  return result.rows;
}

async function upsertBranchPolicy(identity: Identity, repositoryId: string, body: any) {
  requireScope(identity, "sessions:write"); await requireActiveEntitlement(identity); await requireRepository(identity, repositoryId);
  const branchName = String(body.branchName ?? "").trim();
  if (!branchName || branchName.length > 255 || /[\u0000-\u001f]/.test(branchName)) throw new HttpError(400, "valid branchName is required");
  const requiredApprovals = Number(body.requiredApprovals ?? 1);
  const requiredHumanApprovals = Number(body.requiredHumanApprovals ?? 0);
  if (!Number.isInteger(requiredApprovals) || requiredApprovals < 0 || requiredApprovals > 100) throw new HttpError(400, "requiredApprovals must be an integer from 0 to 100");
  if (!Number.isInteger(requiredHumanApprovals) || requiredHumanApprovals < 0 || requiredHumanApprovals > requiredApprovals) throw new HttpError(400, "requiredHumanApprovals must be between 0 and requiredApprovals");
  const result = await pool.query(`insert into repository_branch_policies(workspace_id,repository_id,branch_name,required_approvals,required_human_approvals,require_independent_approval,require_verification,require_actions_success,block_changes_requested,restrict_ai_merge,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict(repository_id,branch_name) do update set required_approvals=excluded.required_approvals,required_human_approvals=excluded.required_human_approvals,require_independent_approval=excluded.require_independent_approval,require_verification=excluded.require_verification,require_actions_success=excluded.require_actions_success,block_changes_requested=excluded.block_changes_requested,restrict_ai_merge=excluded.restrict_ai_merge,updated_at=now() returning *`, [identity.workspaceId, repositoryId, branchName, requiredApprovals, requiredHumanApprovals, body.requireIndependentApproval !== false, body.requireVerification !== false, body.requireActionsSuccess !== false, body.blockChangesRequested !== false, body.restrictAiMerge === true, identity.principalId]);
  await pool.query("insert into product_events(id,workspace_id,principal_id,event_name,repository_id,properties) values($1,$2,$3,'branch_policy_updated',$4,$5)", [`product_${randomUUID()}`, identity.workspaceId, identity.principalId, repositoryId, JSON.stringify({ branchName, requiredApprovals, requiredHumanApprovals })]);
  return result.rows[0];
}

async function deleteBranchPolicy(identity: Identity, repositoryId: string, branchName: string) {
  requireScope(identity, "sessions:write"); await requireActiveEntitlement(identity); await requireRepository(identity, repositoryId);
  const result = await pool.query("delete from repository_branch_policies where workspace_id=$1 and repository_id=$2 and branch_name=$3 returning branch_name", [identity.workspaceId, repositoryId, branchName]);
  if (!result.rowCount) throw new HttpError(404, "branch policy not found");
  return { repositoryId, branchName, deleted: true };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (req.method === "GET" && url.pathname === "/health") { await pool.query("select 1"); return send(res, 200, { ok: true, service: "sessions-repositories" }); }
    const identity = await authenticate(req);
    if (req.method === "GET" && url.pathname === "/api/repositories") { requireScope(identity, "sessions:read"); const result = await pool.query("select * from hosted_repositories where workspace_id=$1 order by updated_at desc", [identity.workspaceId]); return send(res, 200, result.rows); }
    if (req.method === "POST" && url.pathname === "/api/repositories") return send(res, 201, await upsertRepository(identity, await jsonBody(req)));
    const gitImport = url.pathname.match(/^\/api\/repositories\/([^/]+)\/git-import$/);
    if (req.method === "POST" && gitImport) return send(res, 201, await ingestGitImport(identity, decodeURIComponent(gitImport[1]), await jsonBody(req)));
    const policies = url.pathname.match(/^\/api\/repositories\/([^/]+)\/branch-policies$/);
    if (policies && req.method === "GET") return send(res, 200, await listBranchPolicies(identity, decodeURIComponent(policies[1])));
    if (policies && req.method === "PUT") return send(res, 200, await upsertBranchPolicy(identity, decodeURIComponent(policies[1]), await jsonBody(req)));
    const policy = url.pathname.match(/^\/api\/repositories\/([^/]+)\/branch-policies\/([^/]+)$/);
    if (policy && req.method === "DELETE") return send(res, 200, await deleteBranchPolicy(identity, decodeURIComponent(policy[1]), decodeURIComponent(policy[2])));
    if (await handleReleaseGovernance({ pool, identity, req, url, body: () => jsonBody(req), send: (status, payload) => send(res, status, payload) })) return;
    throw new HttpError(404, "not found");
  } catch (error) { const candidate = error as { status?: number }; const status = error instanceof HttpError ? error.status : typeof candidate?.status === "number" ? candidate.status : 500; const message = error instanceof Error ? error.message : "internal error"; return send(res, status, { error: status >= 500 ? "internal error" : message }); }
});

server.listen(port, "0.0.0.0", () => console.log(JSON.stringify({ level: "info", event: "repositories.started", port })));
async function shutdown() { server.close(async () => { await pool.end(); process.exit(0); }); setTimeout(() => process.exit(1), 10_000).unref(); }
process.on("SIGTERM", () => void shutdown()); process.on("SIGINT", () => void shutdown());
