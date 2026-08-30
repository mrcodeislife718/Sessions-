import { assertConfidence, type SessionEvent } from "@sessions/shared";

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

export interface PromoteMemoryInput {
  id: string;
  workspaceId: string;
  repositoryId: string;
  sessionId?: string;
  kind: MemoryKind;
  subject: string;
  summary: string;
  confidence: number;
  provenanceEvents: SessionEvent[];
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
    id: input.id,
    workspaceId: input.workspaceId,
    repositoryId: input.repositoryId,
    sessionId: input.sessionId,
    kind: input.kind,
    subject: input.subject,
    summary: input.summary,
    confidence: input.confidence,
    provenanceEventIds: [...new Set(input.provenanceEvents.map((event) => event.id))],
    evidenceIds: [...new Set(input.evidenceIds ?? [])],
    supersedesMemoryId: input.supersedesMemoryId,
    status: "active",
    createdAt: now,
    updatedAt: now,
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
