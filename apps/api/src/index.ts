import http from "node:http";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createSnapshot } from "@sessions/codevault-core";
import { createSessionEvent, type ActorIdentity, type SessionEventType } from "@sessions/shared";
import { FixedWindowRateLimiter, bearerToken, hashBearerToken, hasScope, requestId, type RequestIdentity } from "./security.js";
import { incrementMetric, prometheusMetrics, structuredLog } from "./observability.js";

const port = Number(process.env.PORT ?? 4000);
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://sessions:sessions@localhost:5432/sessions";
const allowInsecureLocal = process.env.SESSIONS_ALLOW_INSECURE_LOCAL === "true";
const allowedOrigin = process.env.SESSIONS_CORS_ORIGIN ?? "http://localhost:3000";
const maxBodyBytes = Number(process.env.SESSIONS_MAX_BODY_BYTES ?? 1_048_576);
const rateLimiter = new FixedWindowRateLimiter(Number(process.env.SESSIONS_RATE_LIMIT ?? 300), 60_000);
const pool = new Pool({ connectionString: databaseUrl, max: Number(process.env.SESSIONS_DB_POOL_MAX ?? 20) });

class HttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

function normalizedHttpError(error: unknown): HttpError | null {
  if (error instanceof HttpError) return error;
  const candidate = error as { code?: string; message?: string } | null;
  if (candidate?.code === "42501" && candidate.message?.includes("workspace entitlement does not allow writes")) {
    return new HttpError(402, "workspace writes are suspended by the current billing entitlement; review billing status or restore an active subscription");
  }
  return null;
}

async function jsonBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBodyBytes) throw new HttpError(413, "request body too large");
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new HttpError(400, "invalid JSON body"); }
}

function send(res: http.ServerResponse, status: number, body: unknown, reqId: string, extra: Record<string, string> = {}) {
  res.writeHead(status, {
    "content-type": "application/json",
    "x-request-id": reqId,
    "access-control-allow-origin": allowedOrigin,
    "access-control-allow-headers": "authorization,content-type,x-request-id,idempotency-key",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "cache-control": "no-store",
    ...extra,
  });
  res.end(JSON.stringify(body));
}

function actorFor(identity: RequestIdentity): ActorIdentity {
  return {
    id: identity.principalId,
    kind: identity.principalKind === "ai_worker" ? "ai_agent" : identity.principalKind,
    displayName: identity.displayName,
  };
}

async function authenticate(req: http.IncomingMessage): Promise<RequestIdentity> {
  if (allowInsecureLocal) {
    return {
      credentialId: "credential_local",
      workspaceId: "workspace_local",
      principalId: "human_local",
      principalKind: "human",
      displayName: "Local Developer",
      scopes: ["*"],
      localDevelopment: true,
    };
  }
  const token = bearerToken(req);
  if (!token) throw new HttpError(401, "bearer token required");
  const result = await pool.query(
    `select c.id as credential_id, c.workspace_id, c.principal_id, c.scopes,
            p.kind as principal_kind, p.display_name
       from api_credentials c
       join principals p on p.id = c.principal_id
      where c.token_hash = $1
        and c.status = 'active'
        and p.status = 'active'
        and (c.expires_at is null or c.expires_at > now())`,
    [hashBearerToken(token)],
  );
  if (!result.rowCount) throw new HttpError(401, "invalid or expired credential");
  const row = result.rows[0];
  await pool.query("update api_credentials set last_used_at = now() where id = $1", [row.credential_id]);
  return {
    credentialId: row.credential_id,
    workspaceId: row.workspace_id,
    principalId: row.principal_id,
    principalKind: row.principal_kind,
    displayName: row.display_name,
    scopes: row.scopes ?? [],
  };
}

function requireScope(identity: RequestIdentity, scope: string): void {
  if (!hasScope(identity, scope)) throw new HttpError(403, `missing scope: ${scope}`);
}

async function audit(identity: RequestIdentity, reqId: string, action: string, resourceType: string, resourceId: string | null, outcome: "allowed" | "denied" | "error", metadata: Record<string, unknown> = {}) {
  await pool.query(
    "insert into audit_events (id, workspace_id, principal_id, request_id, action, resource_type, resource_id, outcome, metadata) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [`audit_${randomUUID()}`, identity.workspaceId, identity.principalId, reqId, action, resourceType, resourceId, outcome, JSON.stringify(metadata)],
  );
}

async function sessionAggregate(id: string, workspaceId: string) {
  const session = await pool.query("select * from sessions where id = $1 and workspace_id = $2", [id, workspaceId]);
  if (!session.rowCount) return null;
  const [events, snapshots, verifications] = await Promise.all([
    pool.query("select * from session_events where session_id = $1 order by occurred_at, id", [id]),
    pool.query("select * from snapshots where session_id = $1 order by created_at desc", [id]),
    pool.query("select * from verifications where session_id = $1 order by finished_at desc", [id]),
  ]);
  return { session: session.rows[0], events: events.rows, snapshots: snapshots.rows, verifications: verifications.rows };
}

const server = http.createServer(async (req, res) => {
  const reqId = requestId(req);
  const started = Date.now();
  let identity: RequestIdentity | null = null;
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (req.method === "OPTIONS") return send(res, 204, {}, reqId);
    if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true, service: "sessions-api" }, reqId);
    if (req.method === "GET" && url.pathname === "/ready") {
      await pool.query("select 1");
      return send(res, 200, { ok: true, database: "ready" }, reqId);
    }

    identity = await authenticate(req);
    const rate = rateLimiter.check(identity.credentialId);
    if (!rate.allowed) {
      incrementMetric("rate_limited_total");
      await audit(identity, reqId, "request.rate_limit", "request", null, "denied");
      return send(res, 429, { error: "rate limit exceeded" }, reqId, { "retry-after": String(Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000))) });
    }

    if (req.method === "GET" && url.pathname === "/metrics") {
      requireScope(identity, "metrics:read");
      res.writeHead(200, { "content-type": "text/plain; version=0.0.4", "x-request-id": reqId });
      return res.end(prometheusMetrics());
    }

    if (req.method === "GET" && url.pathname === "/api/sessions") {
      requireScope(identity, "sessions:read");
      const result = await pool.query("select * from sessions where workspace_id = $1 order by created_at desc limit 100", [identity.workspaceId]);
      return send(res, 200, result.rows, reqId);
    }

    if (req.method === "POST" && url.pathname === "/api/sessions") {
      requireScope(identity, "sessions:write");
      const body = await jsonBody(req);
      if (!body.objective || !body.repositoryId) throw new HttpError(400, "objective and repositoryId are required");
      const repository = await pool.query("select id from hosted_repositories where id = $1 and workspace_id = $2", [body.repositoryId, identity.workspaceId]);
      if (!repository.rowCount && !identity.localDevelopment) throw new HttpError(404, "repository not found");
      const id = `session_${randomUUID()}`;
      const projectId = body.projectId ?? "project_default";
      const actor = actorFor(identity);
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query(
          "insert into sessions (id, workspace_id, project_id, repository_id, objective, status, created_at) values ($1,$2,$3,$4,$5,'active',now())",
          [id, identity.workspaceId, projectId, body.repositoryId, body.objective],
        );
        const event = createSessionEvent({ id: `event_${randomUUID()}`, type: "SessionStarted", workspaceId: identity.workspaceId, projectId, repositoryId: body.repositoryId, sessionId: id, actor, payload: { objective: body.objective } });
        await client.query("insert into session_events (id, session_id, type, occurred_at, actor, payload) values ($1,$2,$3,$4,$5,$6)", [event.id, id, event.type, event.occurredAt, JSON.stringify(event.actor), JSON.stringify(event.payload)]);
        await client.query("insert into audit_events (id, workspace_id, principal_id, request_id, action, resource_type, resource_id, outcome, metadata) values ($1,$2,$3,$4,'session.create','session',$5,'allowed',$6)", [`audit_${randomUUID()}`, identity.workspaceId, identity.principalId, reqId, id, JSON.stringify({ repositoryId: body.repositoryId })]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally { client.release(); }
      incrementMetric("sessions_created_total");
      return send(res, 201, await sessionAggregate(id, identity.workspaceId), reqId);
    }

    const match = url.pathname.match(/^\/api\/sessions\/([^/]+)(?:\/(events|snapshots|verifications|replay|rollback))?$/);
    if (!match) throw new HttpError(404, "not found");
    const sessionId = match[1];
    const action = match[2];
    const base = await pool.query("select * from sessions where id = $1 and workspace_id = $2", [sessionId, identity.workspaceId]);
    if (!base.rowCount) throw new HttpError(404, "session not found");
    const session = base.rows[0];

    if (req.method === "GET" && !action) {
      requireScope(identity, "sessions:read");
      return send(res, 200, await sessionAggregate(sessionId, identity.workspaceId), reqId);
    }

    const body = await jsonBody(req);
    const actor = actorFor(identity);
    if (req.method === "POST" && action === "events") {
      requireScope(identity, "sessions:write");
      if (!body.type) throw new HttpError(400, "event type is required");
      const event = createSessionEvent({ id: `event_${randomUUID()}`, type: body.type as SessionEventType, workspaceId: session.workspace_id, projectId: session.project_id, repositoryId: session.repository_id, sessionId, actor, payload: body.payload ?? {} });
      await pool.query("insert into session_events (id, session_id, type, occurred_at, actor, payload) values ($1,$2,$3,$4,$5,$6)", [event.id, sessionId, event.type, event.occurredAt, JSON.stringify(event.actor), JSON.stringify(event.payload)]);
      await audit(identity, reqId, "session.event.create", "session", sessionId, "allowed", { eventType: event.type });
      incrementMetric("events_created_total");
      return send(res, 201, event, reqId);
    }

    if (req.method === "POST" && action === "snapshots") {
      requireScope(identity, "sessions:write");
      const snapshot = createSnapshot({ repositoryId: session.repository_id, sessionId, parentSnapshotId: body.parentSnapshotId, entries: body.entries ?? [] });
      await pool.query("insert into snapshots (id, session_id, repository_id, digest, manifest, created_at) values ($1,$2,$3,$4,$5,$6) on conflict (id) do nothing", [snapshot.id, sessionId, session.repository_id, snapshot.digest, JSON.stringify(snapshot), snapshot.createdAt]);
      await pool.query("insert into session_events (id, session_id, type, occurred_at, actor, payload) values ($1,$2,'SnapshotCreated',now(),$3,$4)", [`event_${randomUUID()}`, sessionId, JSON.stringify(actor), JSON.stringify({ snapshotId: snapshot.id, digest: snapshot.digest })]);
      await audit(identity, reqId, "snapshot.create", "snapshot", snapshot.id, "allowed", { sessionId });
      incrementMetric("snapshots_created_total");
      return send(res, 201, snapshot, reqId);
    }

    if (req.method === "POST" && action === "verifications") {
      requireScope(identity, "sessions:verify");
      const id = `verification_${randomUUID()}`;
      const status = body.status ?? "requires_review";
      const finishedAt = new Date().toISOString();
      await pool.query("insert into verifications (id, session_id, snapshot_id, kind, status, summary, requested_by, started_at, finished_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [id, sessionId, body.snapshotId ?? null, body.kind ?? "custom", status, body.summary ?? "Verification recorded", JSON.stringify(actor), body.startedAt ?? finishedAt, finishedAt]);
      const type = status === "passed" ? "VerificationPassed" : "VerificationFailed";
      await pool.query("insert into session_events (id, session_id, type, occurred_at, actor, payload) values ($1,$2,$3,now(),$4,$5)", [`event_${randomUUID()}`, sessionId, type, JSON.stringify(actor), JSON.stringify({ verificationId: id, status })]);
      await audit(identity, reqId, "verification.create", "verification", id, "allowed", { sessionId, status });
      incrementMetric("verifications_created_total");
      return send(res, 201, { id, status }, reqId);
    }

    if (req.method === "POST" && action === "replay") {
      requireScope(identity, "sessions:read");
      const aggregate = await sessionAggregate(sessionId, identity.workspaceId);
      return send(res, 200, { sessionId, mode: "recorded-event-replay", deterministicModelReasoning: false, orderedEvents: aggregate?.events ?? [] }, reqId);
    }

    if (req.method === "POST" && action === "rollback") {
      requireScope(identity, "sessions:rollback");
      const snapshotId = body.snapshotId;
      if (!snapshotId) throw new HttpError(400, "snapshotId is required");
      const snapshot = await pool.query("select * from snapshots where id = $1 and session_id = $2", [snapshotId, sessionId]);
      if (!snapshot.rowCount) throw new HttpError(404, "snapshot not found");
      const rollbackId = `rollback_${randomUUID()}`;
      await pool.query("insert into rollback_requests (id, session_id, snapshot_id, status, requested_by, created_at) values ($1,$2,$3,'planned',$4,now())", [rollbackId, sessionId, snapshotId, JSON.stringify(actor)]);
      await audit(identity, reqId, "rollback.plan", "rollback", rollbackId, "allowed", { sessionId, snapshotId });
      incrementMetric("rollbacks_planned_total");
      return send(res, 202, { sessionId, snapshotId, rollbackId, status: "planned", note: "Execution is delegated to the isolated runner service." }, reqId);
    }

    throw new HttpError(405, "method not allowed");
  } catch (error) {
    const normalized = normalizedHttpError(error);
    const status = normalized?.status ?? 500;
    const message = normalized?.message ?? (error instanceof Error ? error.message : "internal error");
    incrementMetric(status >= 500 ? "requests_error_total" : "requests_rejected_total");
    structuredLog(status >= 500 ? "error" : "warn", "request.failed", { requestId: reqId, status, message, principalId: identity?.principalId, workspaceId: identity?.workspaceId });
    if (identity && (status === 402 || status === 403)) {
      try { await audit(identity, reqId, "request.authorization", "request", null, "denied", { message, status }); } catch (auditError) { structuredLog("error", "audit.failed", { requestId: reqId, error: String(auditError) }); }
    }
    return send(res, status, { error: status >= 500 ? "internal error" : message }, reqId);
  } finally {
    incrementMetric("requests_total");
    structuredLog("info", "request.completed", { requestId: reqId, method: req.method, path: req.url, durationMs: Date.now() - started, principalId: identity?.principalId, workspaceId: identity?.workspaceId });
  }
});

server.keepAliveTimeout = Number(process.env.SESSIONS_KEEP_ALIVE_TIMEOUT_MS ?? 65_000);
server.headersTimeout = Number(process.env.SESSIONS_HEADERS_TIMEOUT_MS ?? 66_000);
server.listen(port, "0.0.0.0", () => structuredLog("info", "server.started", { port, allowInsecureLocal }));

async function shutdown(signal: string) {
  structuredLog("info", "server.shutdown", { signal });
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
