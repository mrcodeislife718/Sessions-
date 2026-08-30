export interface SemanticSourceEvent {
  id: string;
  type: string;
  occurredAt: string;
  workspaceId: string;
  repositoryId: string;
  causationId?: string;
}

function assertConfidence(value: number | undefined, field = "confidence"): number | undefined {
  if (value === undefined) return value;
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${field} must be between 0 and 1`);
  return value;
}

export type SemanticEntityKind = "component" | "file" | "decision" | "assumption" | "failure" | "fix" | "checkpoint" | "verification" | "deployment" | "outcome";

export interface SemanticRelationship {
  id: string;
  workspaceId: string;
  repositoryId: string;
  sourceKind: SemanticEntityKind;
  sourceId: string;
  relationship: string;
  targetKind: SemanticEntityKind;
  targetId: string;
  confidence: number;
  evidenceEventIds: string[];
  analyzerVersion: string;
  createdAt: string;
}

export interface SemanticStore {
  put(relationship: SemanticRelationship): Promise<void>;
  list(repositoryId: string): Promise<SemanticRelationship[]>;
}

export class InMemorySemanticStore implements SemanticStore {
  private readonly relationships = new Map<string, SemanticRelationship>();
  async put(relationship: SemanticRelationship): Promise<void> { this.relationships.set(relationship.id, structuredClone(relationship)); }
  async list(repositoryId: string): Promise<SemanticRelationship[]> { return [...this.relationships.values()].filter((item) => item.repositoryId === repositoryId).map((item) => structuredClone(item)); }
}

export interface SqlResult<T> { rows: T[]; rowCount: number | null; }
export interface SqlExecutor { query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<SqlResult<T>>; }

type SemanticRow = {
  id: string;
  workspace_id: string;
  repository_id: string;
  source_kind: SemanticEntityKind;
  source_id: string;
  relationship: string;
  target_kind: SemanticEntityKind;
  target_id: string;
  confidence: number | string;
  evidence_event_ids: string[] | string;
  analyzer_version: string;
  created_at: Date | string;
};

function jsonArray(value: string[] | string): string[] {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  return Array.isArray(parsed) ? parsed.map(String) : [];
}
function iso(value: Date | string): string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }
function fromRow(row: SemanticRow): SemanticRelationship {
  return { id: row.id, workspaceId: row.workspace_id, repositoryId: row.repository_id, sourceKind: row.source_kind, sourceId: row.source_id, relationship: row.relationship, targetKind: row.target_kind, targetId: row.target_id, confidence: Number(row.confidence), evidenceEventIds: jsonArray(row.evidence_event_ids), analyzerVersion: row.analyzer_version, createdAt: iso(row.created_at) };
}

export class PostgresSemanticStore implements SemanticStore {
  constructor(private readonly sql: SqlExecutor) {}
  async put(edge: SemanticRelationship): Promise<void> {
    assertConfidence(edge.confidence, "semantic confidence");
    await this.sql.query(
      `insert into semantic_relationships
        (id,workspace_id,repository_id,source_kind,source_id,relationship,target_kind,target_id,confidence,evidence_event_ids,analyzer_version,created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       on conflict (id) do update set
         workspace_id=excluded.workspace_id, repository_id=excluded.repository_id,
         source_kind=excluded.source_kind, source_id=excluded.source_id, relationship=excluded.relationship,
         target_kind=excluded.target_kind, target_id=excluded.target_id, confidence=excluded.confidence,
         evidence_event_ids=excluded.evidence_event_ids, analyzer_version=excluded.analyzer_version`,
      [edge.id,edge.workspaceId,edge.repositoryId,edge.sourceKind,edge.sourceId,edge.relationship,edge.targetKind,edge.targetId,edge.confidence,JSON.stringify(edge.evidenceEventIds),edge.analyzerVersion,edge.createdAt],
    );
  }
  async list(repositoryId: string): Promise<SemanticRelationship[]> {
    const result = await this.sql.query<SemanticRow>("select * from semantic_relationships where repository_id=$1 order by created_at,id", [repositoryId]);
    return result.rows.map(fromRow);
  }
}

export interface RecordRelationshipInput {
  id: string;
  workspaceId: string;
  repositoryId: string;
  sourceKind: SemanticEntityKind;
  sourceId: string;
  relationship: string;
  targetKind: SemanticEntityKind;
  targetId: string;
  confidence: number;
  evidenceEvents: SemanticSourceEvent[];
  analyzerVersion: string;
  occurredAt?: string;
}

export async function recordRelationship(store: SemanticStore, input: RecordRelationshipInput): Promise<SemanticRelationship> {
  if (!input.id.trim()) throw new Error("semantic relationship id is required");
  if (!input.sourceId.trim() || !input.targetId.trim()) throw new Error("semantic relationship endpoints are required");
  if (!input.relationship.trim()) throw new Error("semantic relationship type is required");
  if (!input.analyzerVersion.trim()) throw new Error("analyzer version is required");
  assertConfidence(input.confidence, "semantic confidence");
  if (!input.evidenceEvents.length) throw new Error("semantic relationships require evidence");
  if (input.evidenceEvents.some((event) => event.repositoryId !== input.repositoryId)) throw new Error("semantic evidence must belong to the same repository");
  const relationship: SemanticRelationship = {
    id: input.id, workspaceId: input.workspaceId, repositoryId: input.repositoryId, sourceKind: input.sourceKind, sourceId: input.sourceId,
    relationship: input.relationship, targetKind: input.targetKind, targetId: input.targetId, confidence: input.confidence,
    evidenceEventIds: [...new Set(input.evidenceEvents.map((event) => event.id))], analyzerVersion: input.analyzerVersion,
    createdAt: input.occurredAt ?? new Date().toISOString(),
  };
  await store.put(relationship);
  return relationship;
}

export async function neighbors(store: SemanticStore, repositoryId: string, entity: { kind: SemanticEntityKind; id: string }, options: { direction?: "outgoing" | "incoming" | "both"; minimumConfidence?: number } = {}): Promise<SemanticRelationship[]> {
  const minimumConfidence = options.minimumConfidence ?? 0;
  assertConfidence(minimumConfidence, "minimumConfidence");
  const direction = options.direction ?? "both";
  return (await store.list(repositoryId))
    .filter((edge) => edge.confidence >= minimumConfidence)
    .filter((edge) => {
      const outgoing = edge.sourceKind === entity.kind && edge.sourceId === entity.id;
      const incoming = edge.targetKind === entity.kind && edge.targetId === entity.id;
      return direction === "outgoing" ? outgoing : direction === "incoming" ? incoming : outgoing || incoming;
    })
    .sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id));
}

export async function deriveCausalSemanticRelationships(store: SemanticStore, events: SemanticSourceEvent[], analyzerVersion = "causal-v1"): Promise<SemanticRelationship[]> {
  const byId = new Map(events.map((event) => [event.id, event]));
  const created: SemanticRelationship[] = [];
  for (const event of events) {
    if (!event.causationId) continue;
    const parent = byId.get(event.causationId);
    if (!parent || parent.repositoryId !== event.repositoryId) continue;
    const edge = await recordRelationship(store, {
      id: `semantic_${parent.id}_${event.id}_${analyzerVersion}`,
      workspaceId: event.workspaceId,
      repositoryId: event.repositoryId,
      sourceKind: classify(parent),
      sourceId: parent.id,
      relationship: "caused",
      targetKind: classify(event),
      targetId: event.id,
      confidence: 1,
      evidenceEvents: [parent, event],
      analyzerVersion,
      occurredAt: event.occurredAt,
    });
    created.push(edge);
  }
  return created;
}

function classify(event: SemanticSourceEvent): SemanticEntityKind {
  if (event.type.startsWith("Decision")) return "decision";
  if (event.type === "AssumptionRecorded") return "assumption";
  if (event.type === "VerificationFailed") return "failure";
  if (event.type === "VerificationPassed") return "verification";
  if (event.type.startsWith("Deployment")) return "deployment";
  if (event.type === "OutcomeObserved") return "outcome";
  if (event.type === "SnapshotCreated") return "checkpoint";
  if (event.type === "FileChanged") return "file";
  return "component";
}
