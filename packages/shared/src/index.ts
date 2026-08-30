export type ActorKind = "human" | "ai_agent" | "ai_system" | "service";

export interface ActorIdentity {
  id: string;
  kind: ActorKind;
  displayName: string;
  provider?: string;
  model?: string;
  parentActorId?: string;
  metadata?: Record<string, unknown>;
}

export type DecisionEventType =
  | "DecisionProposed"
  | "DecisionMade"
  | "DecisionRejected"
  | "AlternativeConsidered"
  | "AssumptionRecorded"
  | "EvidenceReferenced"
  | "DecisionSuperseded"
  | "OutcomeObserved";

export type SessionEventType =
  | "SessionStarted"
  | "SessionCompleted"
  | "ActorJoined"
  | "AgentExecuted"
  | "SystemExecuted"
  | "HumanActionRecorded"
  | "ToolCalled"
  | "CommandExecuted"
  | "FileChanged"
  | "SnapshotCreated"
  | "SemanticAnalysisCompleted"
  | "VerificationStarted"
  | "VerificationPassed"
  | "VerificationFailed"
  | "DeploymentStarted"
  | "DeploymentCompleted"
  | "DeploymentFailed"
  | "RollbackTriggered"
  | "RollbackCompleted"
  | "ReplayStarted"
  | "ReplayCompleted"
  | DecisionEventType;

export interface SessionEvent<TPayload = Record<string, unknown>> {
  id: string;
  type: SessionEventType;
  occurredAt: string;
  workspaceId: string;
  projectId: string;
  repositoryId: string;
  sessionId: string;
  actor: ActorIdentity;
  correlationId?: string;
  causationId?: string;
  payload: TPayload;
}

export interface SessionObjective {
  summary: string;
  acceptanceCriteria?: string[];
  constraints?: string[];
}

export interface DecisionPayload {
  decisionId: string;
  summary: string;
  rationale?: string;
  alternatives?: string[];
  evidenceIds?: string[];
  assumptionIds?: string[];
  supersedesDecisionId?: string;
  confidence?: number;
  tags?: string[];
}

export interface EvidencePayload {
  evidenceId: string;
  kind: string;
  summary: string;
  uri?: string;
  digest?: string;
  confidence?: number;
}

export interface AssumptionPayload {
  assumptionId: string;
  summary: string;
  confidence?: number;
  expiresAt?: string;
}

export function assertActorIdentity(actor: ActorIdentity): ActorIdentity {
  if (!actor.id.trim()) throw new Error("actor.id is required");
  if (!actor.displayName.trim()) throw new Error("actor.displayName is required");
  return actor;
}

export function assertConfidence(value: number | undefined, field = "confidence"): number | undefined {
  if (value === undefined) return value;
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${field} must be between 0 and 1`);
  return value;
}

export function createSessionEvent<TPayload>(input: Omit<SessionEvent<TPayload>, "occurredAt"> & { occurredAt?: string }): SessionEvent<TPayload> {
  assertActorIdentity(input.actor);
  if (!input.id.trim()) throw new Error("event.id is required");
  if (!input.sessionId.trim()) throw new Error("event.sessionId is required");
  if (input.causationId === input.id) throw new Error("event cannot cause itself");
  return {
    ...input,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
  };
}

export function createDecisionEvent(
  input: Omit<SessionEvent<DecisionPayload>, "occurredAt" | "type"> & {
    type: Extract<DecisionEventType, "DecisionProposed" | "DecisionMade" | "DecisionRejected" | "AlternativeConsidered" | "DecisionSuperseded">;
    occurredAt?: string;
  },
): SessionEvent<DecisionPayload> {
  if (!input.payload.decisionId.trim()) throw new Error("decisionId is required");
  if (!input.payload.summary.trim()) throw new Error("decision summary is required");
  assertConfidence(input.payload.confidence, "decision confidence");
  return createSessionEvent(input);
}
