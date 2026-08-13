import http from "node:http";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createSnapshot } from "@sessions/codevault-core";
import { createSessionEvent, type ActorIdentity, type SessionEventType } from "@sessions/shared";

const port = Number(process.env.PORT ?? 4000);
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://sessions:sessions@localhost:5432/sessions";
const pool = new Pool({ connectionString: databaseUrl });

async function jsonBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(body));
}

function humanActor(body: any): ActorIdentity {
  return body.actor ?? { id: "human_local", kind: "human", displayName: "Local Developer" };
}

async function sessionAggregate(id: string) {
  const session = await pool.query("select * from sessions where id = $1", [id]);
  if (!session.rowCount) return null;
  const [events, snapshots, verifications] = await Promise.all([
    pool.query("select * from session_events where session_id = $1 order by occurred_at, id", [id]),
    pool.query("select * from snapshots where session_id = $1 order by created_at desc", [id]),
    pool.query("select * from verifications where session_id = $1 order by finished_at desc", [id]),
  ]);
  return { session: session.rows[0], events: events.rows, snapshots: snapshots.rows, verifications: verifications.rows };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (req.method === "OPTIONS") return send(res, 204, {});
    if (req.method === "GET" && url.pathname === "/health") {
      await pool.query("select 1");
      return send(res, 200, { ok: true, service: "sessions-api" });
    }
    if (req.method === "GET" && url.pathname === "/api/sessions") {
      const result = await pool.query("select * from sessions order by created_at desc limit 100");
      return send(res, 200, result.rows);
    }
    if (req.method === "POST" && url.pathname === "/api/sessions") {
      const body = await jsonBody(req);
      if (!body.objective || !body.repositoryId) return send(res, 400, { error: "objective and repositoryId are required" });
      const id = `session_${randomUUID()}`;
      const actor = humanActor(body);
      await pool.query(
        "insert into sessions (id, workspace_id, project_id, repository_id, objective, status, created_at) values ($1,$2,$3,$4,$5,'active',now())",
        [id, body.workspaceId ?? "workspace_local", body.projectId ?? "project_local", body.repositoryId, body.objective],
      );
      const event = createSessionEvent({
        id: `event_${randomUUID()}`,
        type: "SessionStarted",
        workspaceId: body.workspaceId ?? "workspace_local",
        projectId: body.projectId ?? "project_local",
        repositoryId: body.repositoryId,
        sessionId: id,
        actor,
        payload: { objective: body.objective },
      });
      await pool.query(
        "insert into session_events (id, session_id, type, occurred_at, actor, payload) values ($1,$2,$3,$4,$5,$6)",
        [event.id, id, event.type, event.occurredAt, JSON.stringify(event.actor), JSON.stringify(event.payload)],
      );
      return send(res, 201, await sessionAggregate(id));
    }

    const match = url.pathname.match(/^\/api\/sessions\/([^/]+)(?:\/(events|snapshots|verifications|replay|rollback))?$/);
    if (!match) return send(res, 404, { error: "not found" });
    const sessionId = match[1];
    const action = match[2];
    if (req.method === "GET" && !action) {
      const aggregate = await sessionAggregate(sessionId);
      return aggregate ? send(res, 200, aggregate) : send(res, 404, { error: "session not found" });
    }
    const base = await pool.query("select * from sessions where id = $1", [sessionId]);
    if (!base.rowCount) return send(res, 404, { error: "session not found" });
    const session = base.rows[0];
    const body = await jsonBody(req);

    if (req.method === "POST" && action === "events") {
      const actor = humanActor(body);
      const event = createSessionEvent({
        id: `event_${randomUUID()}`,
        type: body.type as SessionEventType,
        workspaceId: session.workspace_id,
        projectId: session.project_id,
        repositoryId: session.repository_id,
        sessionId,
        actor,
        payload: body.payload ?? {},
      });
      await pool.query("insert into session_events (id, session_id, type, occurred_at, actor, payload) values ($1,$2,$3,$4,$5,$6)", [event.id, sessionId, event.type, event.occurredAt, JSON.stringify(event.actor), JSON.stringify(event.payload)]);
      return send(res, 201, event);
    }

    if (req.method === "POST" && action === "snapshots") {
      const snapshot = createSnapshot({ repositoryId: session.repository_id, sessionId, parentSnapshotId: body.parentSnapshotId, entries: body.entries ?? [] });
      await pool.query("insert into snapshots (id, session_id, repository_id, digest, manifest, created_at) values ($1,$2,$3,$4,$5,$6) on conflict (id) do nothing", [snapshot.id, sessionId, session.repository_id, snapshot.digest, JSON.stringify(snapshot), snapshot.createdAt]);
      await pool.query("insert into session_events (id, session_id, type, occurred_at, actor, payload) values ($1,$2,'SnapshotCreated',now(),$3,$4)", [`event_${randomUUID()}`, sessionId, JSON.stringify(humanActor(body)), JSON.stringify({ snapshotId: snapshot.id, digest: snapshot.digest })]);
      return send(res, 201, snapshot);
    }

    if (req.method === "POST" && action === "verifications") {
      const id = `verification_${randomUUID()}`;
      const status = body.status ?? "requires_review";
      const finishedAt = new Date().toISOString();
      await pool.query("insert into verifications (id, session_id, snapshot_id, kind, status, summary, requested_by, started_at, finished_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [id, sessionId, body.snapshotId ?? null, body.kind ?? "custom", status, body.summary ?? "Verification recorded", JSON.stringify(humanActor(body)), body.startedAt ?? finishedAt, finishedAt]);
      const type = status === "passed" ? "VerificationPassed" : "VerificationFailed";
      await pool.query("insert into session_events (id, session_id, type, occurred_at, actor, payload) values ($1,$2,$3,now(),$4,$5)", [`event_${randomUUID()}`, sessionId, type, JSON.stringify(humanActor(body)), JSON.stringify({ verificationId: id, status })]);
      return send(res, 201, { id, status });
    }

    if (req.method === "POST" && action === "replay") {
      const aggregate = await sessionAggregate(sessionId);
      return send(res, 200, { sessionId, mode: "recorded-event-replay", deterministicModelReasoning: false, orderedEvents: aggregate?.events ?? [] });
    }

    if (req.method === "POST" && action === "rollback") {
      const snapshotId = body.snapshotId;
      if (!snapshotId) return send(res, 400, { error: "snapshotId is required" });
      const snapshot = await pool.query("select * from snapshots where id = $1 and session_id = $2", [snapshotId, sessionId]);
      if (!snapshot.rowCount) return send(res, 404, { error: "snapshot not found" });
      await pool.query("insert into rollback_requests (id, session_id, snapshot_id, status, requested_by, created_at) values ($1,$2,$3,'planned',$4,now())", [`rollback_${randomUUID()}`, sessionId, snapshotId, JSON.stringify(humanActor(body))]);
      return send(res, 202, { sessionId, snapshotId, status: "planned", note: "Execution is delegated to the isolated runner service." });
    }

    return send(res, 405, { error: "method not allowed" });
  } catch (error) {
    console.error(error);
    return send(res, 500, { error: error instanceof Error ? error.message : "internal error" });
  }
});

server.listen(port, "0.0.0.0", () => console.log(`Sessions API listening on :${port}`));
