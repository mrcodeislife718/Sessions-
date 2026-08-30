import { assertConfidence, type SessionEvent } from "@sessions/shared";

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
  evidenceEvents: SessionEvent[];
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
    id: input.id,
    workspaceId: input.workspaceId,
    repositoryId: input.repositoryId,
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    relationship: input.relationship,
    targetKind: input.targetKind,
    targetId: input.targetId,
    confidence: input.confidence,
    evidenceEventIds: [...new Set(input.evidenceEvents.map((event) => event.id))],
    analyzerVersion: input.analyzerVersion,
    createdAt: input.occurredAt ?? new Date().toISOString(),
  };
  await store.put(relationship);
  return relationship;
}

export async function neighbors(
  store: SemanticStore,
  repositoryId: string,
  entity: { kind: SemanticEntityKind; id: string },
  options: { direction?: "outgoing" | "incoming" | "both"; minimumConfidence?: number } = {},
): Promise<SemanticRelationship[]> {
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

export async function deriveCausalSemanticRelationships(
  store: SemanticStore,
  events: SessionEvent[],
  analyzerVersion = "causal-v1",
): Promise<SemanticRelationship[]> {
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

function classify(event: SessionEvent): SemanticEntityKind {
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
