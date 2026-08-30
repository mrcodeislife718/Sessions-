import type { SessionEvent } from "@sessions/shared";

export interface TimelineStore {
  append(event: SessionEvent): Promise<void>;
  list(sessionId: string): Promise<SessionEvent[]>;
}

export class CausalIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CausalIntegrityError";
  }
}

function stableEvent(event: SessionEvent): string {
  return JSON.stringify({
    id: event.id,
    type: event.type,
    occurredAt: event.occurredAt,
    workspaceId: event.workspaceId,
    projectId: event.projectId,
    repositoryId: event.repositoryId,
    sessionId: event.sessionId,
    actor: event.actor,
    correlationId: event.correlationId ?? null,
    causationId: event.causationId ?? null,
    payload: event.payload,
  });
}

function validateEventShape(event: SessionEvent): void {
  if (!event.id.trim()) throw new CausalIntegrityError("event id is required");
  if (!event.sessionId.trim()) throw new CausalIntegrityError("session id is required");
  if (event.causationId === event.id) throw new CausalIntegrityError("event cannot cause itself");
}

export class InMemoryTimelineStore implements TimelineStore {
  private readonly events = new Map<string, SessionEvent[]>();
  private readonly byId = new Map<string, SessionEvent>();

  async append(event: SessionEvent): Promise<void> {
    validateEventShape(event);
    const duplicate = this.byId.get(event.id);
    if (duplicate) {
      if (stableEvent(duplicate) !== stableEvent(event)) throw new CausalIntegrityError(`conflicting duplicate event id: ${event.id}`);
      return;
    }
    if (event.causationId) {
      const parent = this.byId.get(event.causationId);
      if (!parent) throw new CausalIntegrityError(`missing causal parent: ${event.causationId}`);
      if (parent.sessionId !== event.sessionId) throw new CausalIntegrityError("cross-session causation is not allowed");
    }
    const current = this.events.get(event.sessionId) ?? [];
    this.events.set(event.sessionId, [...current, event]);
    this.byId.set(event.id, event);
  }

  async list(sessionId: string): Promise<SessionEvent[]> {
    return [...(this.events.get(sessionId) ?? [])].sort(compareEvents);
  }
}

export interface SqlResult<T> { rows: T[]; rowCount: number | null; }
export interface SqlConnection {
  query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<SqlResult<T>>;
  release(): void;
}
export interface SqlPool { connect(): Promise<SqlConnection>; }

type EventRow = {
  id: string;
  session_id: string;
  type: SessionEvent["type"];
  occurred_at: Date | string;
  actor: SessionEvent["actor"] | string;
  payload: SessionEvent["payload"] | string;
  correlation_id?: string | null;
  causation_id?: string | null;
  workspace_id?: string | null;
  project_id?: string | null;
  repository_id?: string | null;
};

function parseJson<T>(value: T | string): T {
  return typeof value === "string" ? JSON.parse(value) as T : value;
}

function fromRow(row: EventRow, defaults?: { workspaceId?: string; projectId?: string; repositoryId?: string }): SessionEvent {
  return {
    id: row.id,
    type: row.type,
    occurredAt: row.occurred_at instanceof Date ? row.occurred_at.toISOString() : String(row.occurred_at),
    workspaceId: row.workspace_id ?? defaults?.workspaceId ?? "",
    projectId: row.project_id ?? defaults?.projectId ?? "",
    repositoryId: row.repository_id ?? defaults?.repositoryId ?? "",
    sessionId: row.session_id,
    actor: parseJson(row.actor),
    correlationId: row.correlation_id ?? undefined,
    causationId: row.causation_id ?? undefined,
    payload: parseJson(row.payload),
  };
}

export class PostgresTimelineStore implements TimelineStore {
  constructor(private readonly pool: SqlPool) {}

  async append(event: SessionEvent): Promise<void> {
    validateEventShape(event);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const duplicate = await client.query<EventRow>(
        "select id,session_id,type,occurred_at,actor,payload,correlation_id,causation_id,workspace_id,project_id,repository_id from session_events where id=$1 for update",
        [event.id],
      );
      if (duplicate.rowCount) {
        const existing = fromRow(duplicate.rows[0]);
        if (stableEvent(existing) !== stableEvent(event)) throw new CausalIntegrityError(`conflicting duplicate event id: ${event.id}`);
        await client.query("commit");
        return;
      }
      if (event.causationId) {
        const parent = await client.query<{ session_id: string }>("select session_id from session_events where id=$1", [event.causationId]);
        if (!parent.rowCount) throw new CausalIntegrityError(`missing causal parent: ${event.causationId}`);
        if (parent.rows[0].session_id !== event.sessionId) throw new CausalIntegrityError("cross-session causation is not allowed");
      }
      await client.query(
        `insert into session_events
          (id,session_id,type,occurred_at,actor,payload,correlation_id,causation_id,workspace_id,project_id,repository_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [event.id,event.sessionId,event.type,event.occurredAt,JSON.stringify(event.actor),JSON.stringify(event.payload),event.correlationId??null,event.causationId??null,event.workspaceId,event.projectId,event.repositoryId],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async list(sessionId: string): Promise<SessionEvent[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query<EventRow>(
        "select id,session_id,type,occurred_at,actor,payload,correlation_id,causation_id,workspace_id,project_id,repository_id from session_events where session_id=$1 order by occurred_at,id",
        [sessionId],
      );
      return result.rows.map((row) => fromRow(row));
    } finally {
      client.release();
    }
  }
}

function compareEvents(a: SessionEvent, b: SessionEvent): number {
  const byTime = a.occurredAt.localeCompare(b.occurredAt);
  return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
}

export interface CausalQueryOptions { maxDepth?: number; maxResults?: number; }
export interface CausalPathResult {
  sessionId: string;
  targetId: string;
  events: SessionEvent[];
  truncated: boolean;
}

function bounded(options?: CausalQueryOptions) {
  return { maxDepth: Math.max(1, Math.min(options?.maxDepth ?? 64, 512)), maxResults: Math.max(1, Math.min(options?.maxResults ?? 10_000, 100_000)) };
}

export async function causes(store: TimelineStore, sessionId: string, eventId: string): Promise<SessionEvent[]> {
  const events = await store.list(sessionId);
  const byId = new Map(events.map((event) => [event.id, event]));
  const event = byId.get(eventId);
  if (!event?.causationId) return [];
  const parent = byId.get(event.causationId);
  return parent ? [parent] : [];
}

export async function why(store: TimelineStore, sessionId: string, targetId: string, options?: CausalQueryOptions): Promise<CausalPathResult> {
  const events = await store.list(sessionId);
  const byId = new Map(events.map((event) => [event.id, event]));
  const limits = bounded(options);
  const result: SessionEvent[] = [];
  const seen = new Set<string>();
  let current = byId.get(targetId);
  let depth = 0;
  let truncated = false;
  while (current) {
    if (seen.has(current.id)) throw new CausalIntegrityError(`cycle detected at ${current.id}`);
    seen.add(current.id);
    result.push(current);
    if (result.length >= limits.maxResults || depth >= limits.maxDepth) { truncated = Boolean(current.causationId); break; }
    current = current.causationId ? byId.get(current.causationId) : undefined;
    depth += 1;
  }
  return { sessionId, targetId, events: result.reverse(), truncated };
}

export async function consequences(store: TimelineStore, sessionId: string, sourceId: string, options?: CausalQueryOptions): Promise<CausalPathResult> {
  const events = await store.list(sessionId);
  const limits = bounded(options);
  const children = new Map<string, SessionEvent[]>();
  for (const event of events) if (event.causationId) children.set(event.causationId, [...(children.get(event.causationId) ?? []), event]);
  const queue: Array<{ id: string; depth: number }> = [{ id: sourceId, depth: 0 }];
  const seen = new Set<string>();
  const result: SessionEvent[] = [];
  let truncated = false;
  while (queue.length) {
    const next = queue.shift()!;
    if (seen.has(next.id)) continue;
    seen.add(next.id);
    const event = events.find((candidate) => candidate.id === next.id);
    if (event) result.push(event);
    if (result.length >= limits.maxResults || next.depth >= limits.maxDepth) { truncated = queue.length > 0 || (children.get(next.id)?.length ?? 0) > 0; continue; }
    for (const child of (children.get(next.id) ?? []).sort(compareEvents)) queue.push({ id: child.id, depth: next.depth + 1 });
  }
  return { sessionId, targetId: sourceId, events: result.sort(compareEvents), truncated };
}

export interface ReplayPlan {
  sessionId: string;
  orderedEvents: SessionEvent[];
  actorIds: string[];
  containsModelReexecution: boolean;
}

export async function createReplayPlan(store: TimelineStore, sessionId: string): Promise<ReplayPlan> {
  const orderedEvents = await store.list(sessionId);
  const actorIds = [...new Set(orderedEvents.map((event) => event.actor.id))];
  const containsModelReexecution = orderedEvents.some((event) => event.type === "AgentExecuted" || event.type === "SystemExecuted");
  return { sessionId, orderedEvents, actorIds, containsModelReexecution };
}
