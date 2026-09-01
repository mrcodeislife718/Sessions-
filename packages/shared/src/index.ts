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

export type ExecutionEventType =
  | "ObjectiveReceived"
  | "PlanCreated"
  | "TaskCreated"
  | "WorkerAssigned"
  | "ProviderSessionBound"
  | "AuthorityEvaluated"
  | "WorktreeCreated"
  | "FilesInspected"
  | "PatchProposed"
  | "PatchApproved"
  | "TestExecuted"
  | "ReviewPassed"
  | "ReviewFailed"
  | "CommitCreated"
  | "RepairStarted"
  | "RepairCompleted"
  | "TaskCompleted"
  | "TaskFailed";

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
  | DecisionEventType
  | ExecutionEventType;

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

export interface ExecutionLineagePayload {
  objectiveId?: string;
  taskId?: string;
  logicalWorkerId?: string;
  providerSessionId?: string;
  provider?: string;
  model?: string;
  role?: string;
  authorityDecision?: "allowed" | "denied" | "approval_required";
  approvalId?: string;
  commandClass?: string;
  tool?: string;
  args?: string[];
  branch?: string;
  worktree?: string;
  path?: string;
  beforeHash?: string;
  afterHash?: string;
  checkpointId?: string;
  commitSha?: string;
  verificationId?: string;
  evidenceIds?: string[];
  failureCategory?: string;
  retryable?: boolean;
  replanRequired?: boolean;
  rollbackRequired?: boolean;
  outcome?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
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
  return { ...input, occurredAt: input.occurredAt ?? new Date().toISOString() };
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

const taskRequired = new Set<ExecutionEventType>([
  "TaskCreated", "WorkerAssigned", "ProviderSessionBound", "AuthorityEvaluated", "WorktreeCreated", "FilesInspected",
  "PatchProposed", "PatchApproved", "TestExecuted", "ReviewPassed", "ReviewFailed", "CommitCreated", "RepairStarted",
  "RepairCompleted", "TaskCompleted", "TaskFailed",
]);

export function createExecutionEvent(
  input: Omit<SessionEvent<ExecutionLineagePayload>, "occurredAt"> & { type: ExecutionEventType; occurredAt?: string },
): SessionEvent<ExecutionLineagePayload> {
  const payload = input.payload ?? {};
  if (taskRequired.has(input.type) && !payload.taskId?.trim()) throw new Error(`${input.type} requires payload.taskId`);
  if ((input.type === "WorkerAssigned" || input.type === "ProviderSessionBound") && !payload.logicalWorkerId?.trim()) throw new Error(`${input.type} requires payload.logicalWorkerId`);
  if (input.type === "ProviderSessionBound" && !payload.providerSessionId?.trim()) throw new Error("ProviderSessionBound requires payload.providerSessionId");
  if (input.type === "AuthorityEvaluated" && !payload.authorityDecision) throw new Error("AuthorityEvaluated requires payload.authorityDecision");
  if (input.type === "WorktreeCreated" && !payload.worktree?.trim()) throw new Error("WorktreeCreated requires payload.worktree");
  if (input.type === "CommitCreated" && !payload.commitSha?.trim()) throw new Error("CommitCreated requires payload.commitSha");
  if ((input.type === "ReviewPassed" || input.type === "TestExecuted") && (!payload.evidenceIds || payload.evidenceIds.length === 0)) throw new Error(`${input.type} requires evidenceIds`);
  if (input.type === "TaskCompleted" && (!payload.evidenceIds || payload.evidenceIds.length === 0)) throw new Error("TaskCompleted requires evidenceIds");
  return createSessionEvent(input);
}
