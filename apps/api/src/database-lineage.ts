import type { Pool } from "pg";

export type LineageQueryOptions = { maxDepth: number; maxResults: number };

type EventRow = {
  id: string;
  session_id: string;
  type: string;
  occurred_at: Date | string;
  actor: unknown;
  payload: unknown;
  correlation_id: string | null;
  causation_id: string | null;
  workspace_id: string | null;
  project_id: string | null;
  repository_id: string | null;
  depth?: number;
  cycle?: boolean;
};

const targetFields = [
  "decisionId", "checkpointId", "snapshotId", "verificationId", "deploymentId", "rollbackId", "releaseId", "outcomeId",
  "objectiveId", "taskId", "logicalWorkerId", "providerSessionId", "approvalId", "worktree", "commitSha",
];

function normalize(row: EventRow) {
  return {
    id: row.id,
    type: row.type,
    occurredAt: row.occurred_at instanceof Date ? row.occurred_at.toISOString() : new Date(row.occurred_at).toISOString(),
    workspaceId: row.workspace_id ?? "",
    projectId: row.project_id ?? "",
    repositoryId: row.repository_id ?? "",
    sessionId: row.session_id,
    actor: typeof row.actor === "string" ? JSON.parse(row.actor) : row.actor,
    correlationId: row.correlation_id ?? undefined,
    causationId: row.causation_id ?? undefined,
    payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
  };
}

async function resolveTarget(pool: Pool, workspaceId: string, sessionId: string, target: string): Promise<EventRow | null> {
  const predicates = ["id=$3", ...targetFields.map((field) => `payload->>'${field}'=$3`)].join(" or ");
  const result = await pool.query<EventRow>(`
    select id,session_id,type,occurred_at,actor,payload,correlation_id,causation_id,workspace_id,project_id,repository_id
    from session_events
    where workspace_id=$1 and session_id=$2 and (${predicates})
    order by case when id=$3 then 0 else 1 end, occurred_at desc, id
    limit 1
  `, [workspaceId, sessionId, target]);
  return result.rows[0] ?? null;
}

export async function queryDatabaseLineage(pool: Pool, workspaceId: string, sessionId: string, target: string, action: "why" | "causes" | "consequences" | "lineage", options: LineageQueryOptions) {
  const resolved = await resolveTarget(pool, workspaceId, sessionId, target);
  if (!resolved) return null;

  if (action === "causes") {
    if (!resolved.causation_id) return { sessionId, target, resolvedEventId: resolved.id, events: [] };
    const parent = await pool.query<EventRow>(`
      select id,session_id,type,occurred_at,actor,payload,correlation_id,causation_id,workspace_id,project_id,repository_id
      from session_events where workspace_id=$1 and session_id=$2 and id=$3 limit 1
    `, [workspaceId, sessionId, resolved.causation_id]);
    return { sessionId, target, resolvedEventId: resolved.id, events: parent.rows.map(normalize) };
  }

  const ancestryResult = action === "why" || action === "lineage" ? await pool.query<EventRow>(`
    with recursive ancestry as (
      select e.*, 0::int as depth, array[e.id]::text[] as path, false as cycle
      from session_events e where e.workspace_id=$1 and e.session_id=$2 and e.id=$3
      union all
      select p.*, a.depth + 1, a.path || p.id, p.id = any(a.path)
      from ancestry a
      join session_events p on p.id=a.causation_id and p.session_id=$2 and p.workspace_id=$1
      where a.depth < $4 and not a.cycle
    )
    select id,session_id,type,occurred_at,actor,payload,correlation_id,causation_id,workspace_id,project_id,repository_id,depth,cycle
    from ancestry order by depth desc limit $5
  `, [workspaceId, sessionId, resolved.id, options.maxDepth, options.maxResults + 1]) : { rows: [] as EventRow[] };

  const descendantsResult = action === "consequences" || action === "lineage" ? await pool.query<EventRow>(`
    with recursive descendants as (
      select e.*, 0::int as depth, array[e.id]::text[] as path, false as cycle
      from session_events e where e.workspace_id=$1 and e.session_id=$2 and e.id=$3
      union all
      select c.*, d.depth + 1, d.path || c.id, c.id = any(d.path)
      from descendants d
      join session_events c on c.causation_id=d.id and c.session_id=$2 and c.workspace_id=$1
      where d.depth < $4 and not d.cycle
    )
    select id,session_id,type,occurred_at,actor,payload,correlation_id,causation_id,workspace_id,project_id,repository_id,depth,cycle
    from descendants order by depth,occurred_at,id limit $5
  `, [workspaceId, sessionId, resolved.id, options.maxDepth, options.maxResults + 1]) : { rows: [] as EventRow[] };

  const ancestryTruncated = ancestryResult.rows.length > options.maxResults;
  const descendantsTruncated = descendantsResult.rows.length > options.maxResults;
  const ancestryRows = ancestryResult.rows.slice(0, options.maxResults);
  const descendantRows = descendantsResult.rows.slice(0, options.maxResults);
  if ([...ancestryRows, ...descendantRows].some((row) => row.cycle)) throw Object.assign(new Error(`causal cycle detected at ${resolved.id}`), { statusCode: 409 });

  if (action === "why") return { sessionId, target, resolvedEventId: resolved.id, events: ancestryRows.map(normalize), truncated: ancestryTruncated };
  if (action === "consequences") return { sessionId, target, resolvedEventId: resolved.id, events: descendantRows.map(normalize), truncated: descendantsTruncated };

  const combined = new Map([...ancestryRows, ...descendantRows].map((row) => [row.id, normalize(row)]));
  return {
    sessionId,
    target,
    resolvedEventId: resolved.id,
    ancestry: ancestryRows.map(normalize),
    descendants: descendantRows.map(normalize),
    events: [...combined.values()].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id)),
    truncated: ancestryTruncated || descendantsTruncated,
  };
}
