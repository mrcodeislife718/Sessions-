import { randomUUID } from "node:crypto";
import type http from "node:http";
import type { Pool } from "pg";
import { createSessionEvent, type ActorIdentity, type SessionEventType } from "@sessions/shared";
import { PostgresTimelineStore, causes, consequences, why, type SqlPool } from "@sessions/timeline-engine";
import { hasScope, type RequestIdentity } from "./security.js";

export class ReasoningGraphHttpError extends Error {
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
  if (!hasScope(identity, scope)) throw new ReasoningGraphHttpError(403, `missing scope: ${scope}`);
}

function actorFor(identity: RequestIdentity): ActorIdentity {
  return { id: identity.principalId, kind: identity.principalKind === "ai_worker" ? "ai_agent" : identity.principalKind, displayName: identity.displayName };
}

function storeFor(pool: Pool) {
  return new PostgresTimelineStore(pool as unknown as SqlPool);
}

async function sessionFor(pool: Pool, sessionId: string, workspaceId: string) {
  const result = await pool.query("select * from sessions where id=$1 and workspace_id=$2", [sessionId, workspaceId]);
  return result.rows[0] ?? null;
}

export async function handleReasoningGraph(ctx: Context): Promise<boolean> {
  const { pool, identity, req, url, send } = ctx;
  const graphMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/(why|causes|consequences|lineage)\/([^/]+)$/);
  if (req.method === "GET" && graphMatch) {
    requireScope(identity, "sessions:read");
    const [, sessionId, action, eventId] = graphMatch;
    const session = await sessionFor(pool, sessionId, identity.workspaceId);
    if (!session) throw new ReasoningGraphHttpError(404, "session not found");
    const store = storeFor(pool);
    const options = {
      maxDepth: Number(url.searchParams.get("maxDepth") ?? 64),
      maxResults: Number(url.searchParams.get("maxResults") ?? 10_000),
    };
    if (action === "why") { send(200, await why(store, sessionId, eventId, options)); return true; }
    if (action === "causes") { send(200, { sessionId, eventId, events: await causes(store, sessionId, eventId) }); return true; }
    if (action === "consequences") { send(200, await consequences(store, sessionId, eventId, options)); return true; }
    const [ancestry, descendants] = await Promise.all([why(store, sessionId, eventId, options), consequences(store, sessionId, eventId, options)]);
    const combined = new Map([...ancestry.events, ...descendants.events].map((event) => [event.id, event]));
    send(200, {
      sessionId,
      eventId,
      ancestry: ancestry.events,
      descendants: descendants.events,
      events: [...combined.values()].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id)),
      truncated: ancestry.truncated || descendants.truncated,
    });
    return true;
  }

  const eventMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/events$/);
  if (req.method === "POST" && eventMatch) {
    requireScope(identity, "sessions:write");
    const sessionId = eventMatch[1];
    const session = await sessionFor(pool, sessionId, identity.workspaceId);
    if (!session) throw new ReasoningGraphHttpError(404, "session not found");
    const body = await ctx.body();
    if (!body.type) throw new ReasoningGraphHttpError(400, "event type is required");
    const event = createSessionEvent({
      id: body.id?.trim() || `event_${randomUUID()}`,
      type: body.type as SessionEventType,
      workspaceId: session.workspace_id,
      projectId: session.project_id,
      repositoryId: session.repository_id,
      sessionId,
      actor: actorFor(identity),
      correlationId: body.correlationId?.trim() || undefined,
      causationId: body.causationId?.trim() || undefined,
      payload: body.payload ?? {},
    });
    await storeFor(pool).append(event);
    send(201, event);
    return true;
  }

  return false;
}
