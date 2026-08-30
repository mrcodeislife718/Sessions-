export interface MemorySourceEvent { id: string; repositoryId: string; }

function assertConfidence(value: number | undefined, field = "confidence"): number | undefined {
  if (value === undefined) return value;
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${field} must be between 0 and 1`);
  return value;
}

export type MemoryKind = "decision" | "assumption" | "failure" | "fix" | "convention" | "architecture" | "outcome";
export type MemoryStatus = "active" | "superseded" | "invalidated";

export interface EngineeringMemory {
  id: string;
  workspaceId: string;
  repositoryId: string;
  sessionId?: string;
  kind: MemoryKind;
  subject: string;
  summary: string;
  confidence: number;
  provenanceEventIds: string[];
  evidenceIds: string[];
  supersedesMemoryId?: string;
  status: MemoryStatus;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryStore {
  put(memory: EngineeringMemory): Promise<void>;
  get(id: string): Promise<EngineeringMemory | undefined>;
  list(repositoryId: string): Promise<EngineeringMemory[]>;
}

export class InMemoryMemoryStore implements MemoryStore {
  private readonly memories = new Map<string, EngineeringMemory>();
  async put(memory: EngineeringMemory): Promise<void> { this.memories.set(memory.id, structuredClone(memory)); }
  async get(id: string): Promise<EngineeringMemory | undefined> { const value = this.memories.get(id); return value ? structuredClone(value) : undefined; }
  async list(repositoryId: string): Promise<EngineeringMemory[]> { return [...this.memories.values()].filter((memory) => memory.repositoryId === repositoryId).map((memory) => structuredClone(memory)); }
}

export interface SqlResult<T> { rows: T[]; rowCount: number | null; }
export interface SqlExecutor { query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<SqlResult<T>>; }

type MemoryRow = {
  id: string;
  workspace_id: string;
  repository_id: string;
  session_id: string | null;
  kind: MemoryKind;
  subject: string;
  summary: string;
  confidence: number | string;
  provenance_event_ids: string[] | string;
  evidence_ids: string[] | string;
  supersedes_memory_id: string | null;
  status: MemoryStatus;
  created_at: Date | string;
  updated_at: Date | string;
};

function jsonArray(value: string[] | string): string[] {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  return Array.isArray(parsed) ? parsed.map(String) : [];
}
function iso(value: Date | string): string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }
function fromRow(row: MemoryRow): EngineeringMemory {
  return { id: row.id, workspaceId: row.workspace_id, repositoryId: row.repository_id, sessionId: row.session_id ?? undefined, kind: row.kind, subject: row.subject, summary: row.summary, confidence: Number(row.confidence), provenanceEventIds: jsonArray(row.provenance_event_ids), evidenceIds: jsonArray(row.evidence_ids), supersedesMemoryId: row.supersedes_memory_id ?? undefined, status: row.status, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}

export class PostgresMemoryStore implements MemoryStore {
  constructor(private readonly sql: SqlExecutor) {}
  async put(memory: EngineeringMemory): Promise<void> {
    assertConfidence(memory.confidence, "memory confidence");
    await this.sql.query(
      `insert into engineering_memory
        (id,workspace_id,repository_id,session_id,kind,subject,summary,confidence,provenance_event_ids,evidence_ids,supersedes_memory_id,status,created_at,updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       on conflict (id) do update set
         workspace_id=excluded.workspace_id, repository_id=excluded.repository_id, session_id=excluded.session_id,
         kind=excluded.kind, subject=excluded.subject, summary=excluded.summary, confidence=excluded.confidence,
         provenance_event_ids=excluded.provenance_event_ids, evidence_ids=excluded.evidence_ids,
         supersedes_memory_id=excluded.supersedes_memory_id, status=excluded.status, updated_at=excluded.updated_at`,
      [memory.id,memory.workspaceId,memory.repositoryId,memory.sessionId??null,memory.kind,memory.subject,memory.summary,memory.confidence,JSON.stringify(memory.provenanceEventIds),JSON.stringify(memory.evidenceIds),memory.supersedesMemoryId??null,memory.status,memory.createdAt,memory.updatedAt],
    );
  }
  async get(id: string): Promise<EngineeringMemory | undefined> {
    const result = await this.sql.query<MemoryRow>("select * from engineering_memory where id=$1", [id]);
    return result.rowCount ? fromRow(result.rows[0]) : undefined;
  }
  async list(repositoryId: string): Promise<EngineeringMemory[]> {
    const result = await this.sql.query<MemoryRow>("select * from engineering_memory where repository_id=$1 order by updated_at desc,id", [repositoryId]);
    return result.rows.map(fromRow);
  }
}

export interface PromoteMemoryInput {
  id: string;
  workspaceId: string;
  repositoryId: string;
  sessionId?: string;
  kind: MemoryKind;
  subject: string;
  summary: string;
  confidence: number;
  provenanceEvents: MemorySourceEvent[];
  evidenceIds?: string[];
  supersedesMemoryId?: string;
  occurredAt?: string;
}

export async function promoteMemory(store: MemoryStore, input: PromoteMemoryInput): Promise<EngineeringMemory> {
  if (!input.id.trim()) throw new Error("memory id is required");
  if (!input.subject.trim()) throw new Error("memory subject is required");
  if (!input.summary.trim()) throw new Error("memory summary is required");
  assertConfidence(input.confidence, "memory confidence");
  if (!input.provenanceEvents.length) throw new Error("memory requires provenance");
  if (input.provenanceEvents.some((event) => event.repositoryId !== input.repositoryId)) throw new Error("memory provenance must belong to the same repository");
  const now = input.occurredAt ?? new Date().toISOString();
  const existing = await store.get(input.id);
  if (existing && existing.status !== "invalidated") throw new Error(`memory already exists: ${input.id}`);
  if (input.supersedesMemoryId) {
    const previous = await store.get(input.supersedesMemoryId);
    if (!previous) throw new Error(`superseded memory not found: ${input.supersedesMemoryId}`);
    await store.put({ ...previous, status: "superseded", updatedAt: now });
  }
  const memory: EngineeringMemory = {
    id: input.id, workspaceId: input.workspaceId, repositoryId: input.repositoryId, sessionId: input.sessionId,
    kind: input.kind, subject: input.subject, summary: input.summary, confidence: input.confidence,
    provenanceEventIds: [...new Set(input.provenanceEvents.map((event) => event.id))], evidenceIds: [...new Set(input.evidenceIds ?? [])],
    supersedesMemoryId: input.supersedesMemoryId, status: "active", createdAt: now, updatedAt: now,
  };
  await store.put(memory);
  return memory;
}

export async function invalidateMemory(store: MemoryStore, id: string, occurredAt = new Date().toISOString()): Promise<EngineeringMemory> {
  const current = await store.get(id);
  if (!current) throw new Error(`memory not found: ${id}`);
  const next = { ...current, status: "invalidated" as const, updatedAt: occurredAt };
  await store.put(next);
  return next;
}

export async function queryMemory(store: MemoryStore, repositoryId: string, input: { subject?: string; kind?: MemoryKind; minimumConfidence?: number } = {}): Promise<EngineeringMemory[]> {
  const minimumConfidence = input.minimumConfidence ?? 0;
  assertConfidence(minimumConfidence, "minimumConfidence");
  const normalizedSubject = input.subject?.trim().toLowerCase();
  return (await store.list(repositoryId))
    .filter((memory) => memory.status === "active")
    .filter((memory) => !input.kind || memory.kind === input.kind)
    .filter((memory) => memory.confidence >= minimumConfidence)
    .filter((memory) => !normalizedSubject || memory.subject.toLowerCase().includes(normalizedSubject) || memory.summary.toLowerCase().includes(normalizedSubject))
    .sort((a, b) => b.confidence - a.confidence || b.updatedAt.localeCompare(a.updatedAt));
}
