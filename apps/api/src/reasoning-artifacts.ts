import { randomUUID } from "node:crypto";
import type http from "node:http";
import type { Pool, PoolClient } from "pg";
import { createSnapshot } from "@sessions/codevault-core";
import { createSessionEvent, type ActorIdentity } from "@sessions/shared";
import { hasScope, type RequestIdentity } from "./security.js";
import { persistCausalEvent } from "./causal-persistence.js";

export class ReasoningArtifactHttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

type Context = {
  pool: Pool;
  identity: RequestIdentity;
  req: http.IncomingMessage;
  url: URL;
  body: () => Promise<any>;
  send: (status: number, body: unknown) => void;
};

function requireScope(identity: RequestIdentity, scope: string) {
  if (!hasScope(identity, scope)) throw new ReasoningArtifactHttpError(403, `missing scope: ${scope}`);
}
function actorFor(identity: RequestIdentity): ActorIdentity {
  return { id: identity.principalId, kind: identity.principalKind === "ai_worker" ? "ai_agent" : identity.principalKind, displayName: identity.displayName };
}
async function sessionFor(pool: Pool, sessionId: string, workspaceId: string) {
  const result = await pool.query("select * from sessions where id=$1 and workspace_id=$2", [sessionId, workspaceId]);
  return result.rows[0] ?? null;
}
async function latestEventId(client: PoolClient, sessionId: string): Promise<string | undefined> {
  const result = await client.query<{ id: string }>("select id from session_events where session_id=$1 order by occurred_at desc,id desc limit 1", [sessionId]);
  return result.rows[0]?.id;
}
async function eventForPayloadId(client: PoolClient, sessionId: string, key: string, value: string): Promise<string | undefined> {
  const result = await client.query<{ id: string }>(
    `select id from session_events where session_id=$1 and payload->>$2=$3 order by occurred_at desc,id desc limit 1`,
    [sessionId,key,value],
  );
  return result.rows[0]?.id;
}

export async function handleReasoningArtifacts(ctx: Context): Promise<boolean> {
  const { pool, identity, req, url, send } = ctx;
  const match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/(snapshots|verifications)$/);
  if (req.method !== "POST" || !match) return false;
  const [, sessionId, action] = match;
  const session = await sessionFor(pool, sessionId, identity.workspaceId);
  if (!session) throw new ReasoningArtifactHttpError(404, "session not found");
  const body = await ctx.body();
  const actor = actorFor(identity);

  if (action === "snapshots") {
    requireScope(identity, "sessions:write");
    const snapshot = createSnapshot({ repositoryId: session.repository_id, sessionId, parentSnapshotId: body.parentSnapshotId, entries: body.entries ?? [] });
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "insert into snapshots (id,session_id,repository_id,digest,manifest,created_at) values ($1,$2,$3,$4,$5,$6) on conflict(id) do nothing",
        [snapshot.id,sessionId,session.repository_id,snapshot.digest,JSON.stringify(snapshot),snapshot.createdAt],
      );
      const inferredParent = body.causationId?.trim() || await latestEventId(client, sessionId);
      const event = createSessionEvent({
        id: `event_${randomUUID()}`,
        type: "SnapshotCreated",
        workspaceId: session.workspace_id,
        projectId: session.project_id,
        repositoryId: session.repository_id,
        sessionId,
        actor,
        correlationId: body.correlationId?.trim() || undefined,
        causationId: inferredParent,
        payload: { snapshotId: snapshot.id, checkpointId: body.checkpointId ?? null, digest: snapshot.digest },
      });
      await persistCausalEvent(client, event);
      await client.query("commit");
      send(201, { ...snapshot, causalEventId: event.id });
      return true;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  requireScope(identity, "sessions:verify");
  const id = `verification_${randomUUID()}`;
  const status = body.status ?? "requires_review";
  const finishedAt = new Date().toISOString();
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      "insert into verifications (id,session_id,snapshot_id,kind,status,summary,requested_by,started_at,finished_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [id,sessionId,body.snapshotId??null,body.kind??"custom",status,body.summary??"Verification recorded",JSON.stringify(actor),body.startedAt??finishedAt,finishedAt],
    );
    const snapshotParent = body.snapshotId ? await eventForPayloadId(client, sessionId, "snapshotId", String(body.snapshotId)) : undefined;
    const inferredParent = body.causationId?.trim() || snapshotParent || await latestEventId(client, sessionId);
    const event = createSessionEvent({
      id: `event_${randomUUID()}`,
      type: status === "passed" ? "VerificationPassed" : status === "failed" ? "VerificationFailed" : "VerificationStarted",
      workspaceId: session.workspace_id,
      projectId: session.project_id,
      repositoryId: session.repository_id,
      sessionId,
      actor,
      correlationId: body.correlationId?.trim() || undefined,
      causationId: inferredParent,
      payload: { verificationId: id, snapshotId: body.snapshotId ?? null, kind: body.kind ?? "custom", status, summary: body.summary ?? "Verification recorded" },
    });
    await persistCausalEvent(client, event);
    await client.query("commit");
    send(201, { id, status, causalEventId: event.id });
    return true;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
