import { randomUUID } from "node:crypto";
import type http from "node:http";
import type { Pool } from "pg";
import { createSessionEvent, type ActorIdentity, type SessionEvent, type SessionEventType } from "@sessions/shared";
import { hasScope, type RequestIdentity } from "./security.js";
import { handleReasoningArtifacts } from "./reasoning-artifacts.js";
import { persistCausalEvent } from "./causal-persistence.js";

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
async function listEvents(pool: Pool, sessionId: string): Promise<SessionEvent[]> {
  const result = await pool.query<EventRow>("select id,session_id,type,occurred_at,actor,payload,correlation_id,causation_id,workspace_id,project_id,repository_id from session_events where session_id=$1 order by occurred_at,id", [sessionId]);
  return result.rows.map(fromRow);
}
function eventMatchesTarget(event: SessionEvent, target: string): boolean {
  if (event.id === target) return true;
  const payload = event.payload as Record<string, unknown>;
  return ["decisionId","checkpointId","snapshotId","verificationId","deploymentId","rollbackId","releaseId","outcomeId"].some((key) => String(payload?.[key] ?? "") === target);
}
function resolveTarget(events: SessionEvent[], target: string): SessionEvent {
  const event = events.find((candidate) => eventMatchesTarget(candidate, target));
  if (!event) throw new ReasoningGraphHttpError(404, `causal target not found: ${target}`);
  return event;
}
function limits(url: URL): QueryOptions {
  const depth = Number(url.searchParams.get("maxDepth") ?? 64), results = Number(url.searchParams.get("maxResults") ?? 10_000);
  return { maxDepth: Math.max(1, Math.min(Number.isFinite(depth) ? depth : 64, 512)), maxResults: Math.max(1, Math.min(Number.isFinite(results) ? results : 10_000, 100_000)) };
}
function ancestry(events: SessionEvent[], target: string, options: QueryOptions) {
  const byId = new Map(events.map((event) => [event.id, event]));
  let current: SessionEvent | undefined = resolveTarget(events, target);
  const result: SessionEvent[] = [], seen = new Set<string>();
  let depth = 0, truncated = false;
  while (current) {
    if (seen.has(current.id)) throw new ReasoningGraphHttpError(409, `causal cycle detected at ${current.id}`);
    seen.add(current.id); result.push(current);
    if (result.length >= options.maxResults || depth >= options.maxDepth) { truncated = Boolean(current.causationId); break; }
    current = current.causationId ? byId.get(current.causationId) : undefined; depth += 1;
  }
  return { events: result.reverse(), truncated };
}
function descendants(events: SessionEvent[], target: string, options: QueryOptions) {
  const source = resolveTarget(events, target), byId = new Map(events.map((event) => [event.id, event])), children = new Map<string, SessionEvent[]>();
  for (const event of events) if (event.causationId) children.set(event.causationId, [...(children.get(event.causationId) ?? []), event]);
  const queue: Array<{ id: string; depth: number }> = [{ id: source.id, depth: 0 }], seen = new Set<string>(), result: SessionEvent[] = [];
  let truncated = false;
  while (queue.length) {
    const next = queue.shift()!; if (seen.has(next.id)) continue; seen.add(next.id);
    const event = byId.get(next.id); if (event) result.push(event);
    const directChildren = children.get(next.id) ?? [];
    if (result.length >= options.maxResults || next.depth >= options.maxDepth) { if (directChildren.length || queue.length) truncated = true; continue; }
    for (const child of directChildren) queue.push({ id: child.id, depth: next.depth + 1 });
  }
  result.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
  return { events: result, truncated };
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
    const [, sessionId, action, target] = graphMatch;
    if (!await sessionFor(pool, sessionId, identity.workspaceId)) throw new ReasoningGraphHttpError(404, "session not found");
    const events = await listEvents(pool, sessionId), options = limits(url), resolved = resolveTarget(events, target);
    if (action === "why") { send(200, { sessionId, target, resolvedEventId: resolved.id, ...ancestry(events, target, options) }); return true; }
    if (action === "causes") { const parent = resolved.causationId ? events.find((event) => event.id === resolved.causationId) : undefined; send(200, { sessionId, target, resolvedEventId: resolved.id, events: parent ? [parent] : [] }); return true; }
    if (action === "consequences") { send(200, { sessionId, target, resolvedEventId: resolved.id, ...descendants(events, target, options) }); return true; }
    const upstream = ancestry(events, target, options), downstream = descendants(events, target, options);
    const combined = new Map([...upstream.events, ...downstream.events].map((event) => [event.id, event]));
    send(200, { sessionId, target, resolvedEventId: resolved.id, ancestry: upstream.events, descendants: downstream.events, events: [...combined.values()].sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt)||a.id.localeCompare(b.id)), truncated: upstream.truncated || downstream.truncated });
    return true;
  }
  const eventMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/events$/);
  if (req.method === "POST" && eventMatch) {
    requireScope(identity, "sessions:write");
    const sessionId = eventMatch[1], session = await sessionFor(pool, sessionId, identity.workspaceId);
    if (!session) throw new ReasoningGraphHttpError(404, "session not found");
    const body = await ctx.body(); if (!body.type) throw new ReasoningGraphHttpError(400, "event type is required");
    const event = createSessionEvent({ id: body.id?.trim() || `event_${randomUUID()}`, type: body.type as SessionEventType, workspaceId: session.workspace_id, projectId: session.project_id, repositoryId: session.repository_id, sessionId, actor: actorFor(identity), correlationId: body.correlationId?.trim() || undefined, causationId: body.causationId?.trim() || undefined, payload: body.payload ?? {} });
    await appendEvent(pool, event); send(201, event); return true;
  }
  return false;
}
