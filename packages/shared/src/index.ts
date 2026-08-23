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
  | "ReplayCompleted";

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

export function assertActorIdentity(actor: ActorIdentity): ActorIdentity {
  if (!actor.id.trim()) throw new Error("actor.id is required");
  if (!actor.displayName.trim()) throw new Error("actor.displayName is required");
  return actor;
}

export function createSessionEvent<TPayload>(input: Omit<SessionEvent<TPayload>, "occurredAt"> & { occurredAt?: string }): SessionEvent<TPayload> {
  assertActorIdentity(input.actor);
  return {
    ...input,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
  };
}
