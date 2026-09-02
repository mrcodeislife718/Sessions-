import { randomUUID } from "node:crypto";
import type http from "node:http";
import type { Pool } from "pg";
import {
  createExecutionEvent,
  createSessionEvent,
  type ActorIdentity,
  type ExecutionEventType,
  type SessionEvent,
  type SessionEventType,
} from "@sessions/shared";
import { hasScope, type RequestIdentity } from "./security.js";
import { handleReasoningArtifacts } from "./reasoning-artifacts.js";
import { persistCausalEvent } from "./causal-persistence.js";
import { queryDatabaseLineage } from "./database-lineage.js";

export class ReasoningGraphHttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

type Context = { pool: Pool; identity: RequestIdentity; req: http.IncomingMessage; url: URL; body: () => Promise<any>; send: (status: number, body: unknown) => void };
type EventRow = {
  id: string; session_id: string; type: SessionEventType; occurred_at: Date | string; actor: ActorIdentity | string;
  payload: Record<string, unknown> | string; correlation_id: string | null; causation_id: string | null;
  workspace_id: string | null; project_id: string | null; repository_id: string | null;
};
type QueryOptions = { maxDepth: number; maxResults: number };

const executionTypes = new Set<ExecutionEventType>([
  "ObjectiveReceived", "PlanCreated", "TaskCreated", "WorkerAssigned", "ProviderSessionBound", "AuthorityEvaluated",
  "WorktreeCreated", "FilesInspected", "PatchProposed", "PatchApproved", "TestExecuted", "ReviewPassed", "ReviewFailed",
  "CommitCreated", "RepairStarted", "RepairCompleted", "TaskCompleted", "TaskFailed",
]);

function requireScope(identity: RequestIdentity, scope: string) { if (!hasScope(identity, scope)) throw new ReasoningGraphHttpError(403, `missing scope: ${scope}`); }
function actorFor(identity: RequestIdentity): ActorIdentity { return { id: identity.principalId, kind: identity.principalKind === "ai_worker" ? "ai_agent" : identity.principalKind, displayName: identity.displayName }; }
async function sessionFor(pool: Pool, sessionId: string, workspaceId: string) { const result = await pool.query("select * from sessions where id=$1 and workspace_id=$2", [sessionId, workspaceId]); return result.rows[0] ?? null; }
function parseJson<T>(value: T | string): T { return typeof value === "string" ? JSON.parse(value) as T : value; }
function fromRow(row: EventRow): SessionEvent {
  return {
    id: row.id, type: row.type,
    occurredAt: row.occurred_at instanceof Date ? row.occurred_at.toISOString() : new Date(row.occurred_at).toISOString(),
    workspaceId: row.workspace_id ?? "", projectId: row.project_id ?? "", repositoryId: row.repository_id ?? "",
    sessionId: row.session_id, actor: parseJson(row.actor), correlationId: row.correlation_id ?? undefined,
    causationId: row.causation_id ?? undefined, payload: parseJson(row.payload),
  };
}
function limits(url: URL): QueryOptions {
  const depth = Number(url.searchParams.get("maxDepth") ?? 64), results = Number(url.searchParams.get("maxResults") ?? 10_000);
  return { maxDepth: Math.max(1, Math.min(Number.isFinite(depth) ? depth : 64, 512)), maxResults: Math.max(1, Math.min(Number.isFinite(results) ? results : 10_000, 100_000)) };
}
async function appendEvent(pool: Pool, event: SessionEvent): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const duplicate = await client.query<EventRow>("select id,session_id,type,occurred_at,actor,payload,correlation_id,causation_id,workspace_id,project_id,repository_id from session_events where id=$1 for update", [event.id]);
    if (duplicate.rowCount) {
      const existing = fromRow(duplicate.rows[0]);
      if (JSON.stringify(existing) !== JSON.stringify(event)) throw new ReasoningGraphHttpError(409, `conflicting duplicate event id: ${event.id}`);
      await client.query("commit"); return;
    }
    await persistCausalEvent(client, event);
    await client.query("commit");
  } catch (error) { await client.query("rollback").catch(() => undefined); throw error; }
  finally { client.release(); }
}

export async function handleReasoningGraph(ctx: Context): Promise<boolean> {
  const { pool, identity, req, url, send } = ctx;
  if (await handleReasoningArtifacts(ctx)) return true;
  const graphMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/(why|causes|consequences|lineage)\/([^/]+)$/);
  if (req.method === "GET" && graphMatch) {
    requireScope(identity, "sessions:read");
    const [, sessionId, rawAction, target] = graphMatch;
    if (!await sessionFor(pool, sessionId, identity.workspaceId)) throw new ReasoningGraphHttpError(404, "session not found");
    const action = rawAction as "why" | "causes" | "consequences" | "lineage";
    try {
      const result = await queryDatabaseLineage(pool, identity.workspaceId, sessionId, target, action, limits(url));
      if (!result) throw new ReasoningGraphHttpError(404, `causal target not found: ${target}`);
      send(200, result); return true;
    } catch (error) {
      if (error instanceof ReasoningGraphHttpError) throw error;
      if (error instanceof Error && "statusCode" in error && typeof (error as Error & { statusCode?: unknown }).statusCode === "number") {
        throw new ReasoningGraphHttpError((error as Error & { statusCode: number }).statusCode, error.message);
      }
      throw error;
    }
  }
  const eventMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/events$/);
  if (req.method === "POST" && eventMatch) {
    requireScope(identity, "sessions:write");
    const sessionId = eventMatch[1], session = await sessionFor(pool, sessionId, identity.workspaceId);
    if (!session) throw new ReasoningGraphHttpError(404, "session not found");
    const body = await ctx.body(); if (!body.type) throw new ReasoningGraphHttpError(400, "event type is required");
    const base = {
      id: body.id?.trim() || `event_${randomUUID()}`,
      workspaceId: session.workspace_id,
      projectId: session.project_id,
      repositoryId: session.repository_id,
      sessionId,
      actor: actorFor(identity),
      correlationId: body.correlationId?.trim() || undefined,
      causationId: body.causationId?.trim() || undefined,
      payload: body.payload ?? {},
    };
    const event = executionTypes.has(body.type as ExecutionEventType)
      ? createExecutionEvent({ ...base, type: body.type as ExecutionEventType })
      : createSessionEvent({ ...base, type: body.type as SessionEventType });
    await appendEvent(pool, event); send(201, event); return true;
  }
  return false;
}
