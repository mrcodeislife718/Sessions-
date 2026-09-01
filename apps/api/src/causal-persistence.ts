import type { PoolClient } from "pg";
import type { SessionEvent } from "@sessions/shared";

export class CausalPersistenceError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

function semanticKind(type: string): string {
  if (type.startsWith("Decision") || type === "AlternativeConsidered") return "decision";
  if (type === "AssumptionRecorded") return "assumption";
  if (type === "VerificationFailed" || type === "TaskFailed" || type === "ReviewFailed") return "failure";
  if (type === "VerificationPassed" || type === "VerificationStarted" || type === "TestExecuted" || type === "ReviewPassed") return "verification";
  if (type.startsWith("Deployment")) return "deployment";
  if (type === "OutcomeObserved" || type === "TaskCompleted") return "outcome";
  if (type === "SnapshotCreated") return "checkpoint";
  if (type === "FileChanged" || type === "PatchProposed" || type === "PatchApproved") return "file";
  if (type === "TaskCreated") return "task";
  if (type === "WorkerAssigned" || type === "ProviderSessionBound") return "worker";
  if (type === "AuthorityEvaluated") return "authority";
  if (type === "WorktreeCreated") return "worktree";
  if (type === "CommitCreated") return "commit";
  if (type === "ObjectiveReceived" || type === "PlanCreated") return "objective";
  if (type === "RepairStarted" || type === "RepairCompleted") return "repair";
  return "component";
}

function memoryKind(type: string): string | undefined {
  if (type === "DecisionMade") return "decision";
  if (type === "AssumptionRecorded") return "assumption";
  if (type === "VerificationFailed" || type === "TaskFailed" || type === "ReviewFailed") return "failure";
  if (type === "OutcomeObserved" || type === "TaskCompleted") return "outcome";
  return undefined;
}

function safeConfidence(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 1;
}

function memorySubject(event: SessionEvent): string {
  const payload = event.payload as Record<string, unknown>;
  return String(payload.decisionId ?? payload.assumptionId ?? payload.outcomeId ?? payload.verificationId ?? payload.taskId ?? event.type);
}

function memorySummary(event: SessionEvent): string {
  const payload = event.payload as Record<string, unknown>;
  return String(payload.summary ?? payload.rationale ?? payload.message ?? payload.outcome ?? `${event.type} recorded`);
}

export async function persistCausalEvent(client: PoolClient, event: SessionEvent): Promise<void> {
  let parentType: string | undefined;
  if (event.causationId) {
    const parent = await client.query<{ session_id: string; type: string }>("select session_id,type from session_events where id=$1", [event.causationId]);
    if (!parent.rowCount) throw new CausalPersistenceError(409, `missing causal parent: ${event.causationId}`);
    if (parent.rows[0].session_id !== event.sessionId) throw new CausalPersistenceError(409, "cross-session causation is not allowed");
    parentType = parent.rows[0].type;
  }

  await client.query(
    `insert into session_events
     (id,session_id,type,occurred_at,actor,payload,correlation_id,causation_id,workspace_id,project_id,repository_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [event.id,event.sessionId,event.type,event.occurredAt,JSON.stringify(event.actor),JSON.stringify(event.payload),event.correlationId??null,event.causationId??null,event.workspaceId,event.projectId,event.repositoryId],
  );

  if (event.causationId && parentType) {
    const edgeId = `semantic_${event.causationId}_${event.id}_causal-v1`;
    await client.query(
      `insert into semantic_relationships
       (id,workspace_id,repository_id,source_kind,source_id,relationship,target_kind,target_id,confidence,evidence_event_ids,analyzer_version,created_at)
       values ($1,$2,$3,$4,$5,'caused',$6,$7,1,$8,'causal-v1',$9)
       on conflict (id) do nothing`,
      [edgeId,event.workspaceId,event.repositoryId,semanticKind(parentType),event.causationId,semanticKind(event.type),event.id,JSON.stringify([event.causationId,event.id]),event.occurredAt],
    );
  }

  const kind = memoryKind(event.type);
  if (kind) {
    const payload = event.payload as Record<string, unknown>;
    const memoryId = `memory_${event.id}`;
    await client.query(
      `insert into engineering_memory
       (id,workspace_id,repository_id,session_id,kind,subject,summary,confidence,provenance_event_ids,evidence_ids,status,created_at,updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11,$11)
       on conflict (id) do nothing`,
      [memoryId,event.workspaceId,event.repositoryId,event.sessionId,kind,memorySubject(event),memorySummary(event),safeConfidence(payload.confidence),JSON.stringify([event.id]),JSON.stringify(Array.isArray(payload.evidenceIds)?payload.evidenceIds:[]),event.occurredAt],
    );
  }
}
