import { createHash, randomUUID } from "node:crypto";

export type ParticipantKind = "human" | "agent" | "subagent";
export type WorkspaceStatus = "active" | "paused" | "completed" | "cancelled";

export interface WorkspaceParticipant {
  id: string;
  kind: ParticipantKind;
  parentAgentId?: string;
  joinedAt: string;
}

export interface WorkspaceSnapshot {
  id: string;
  digest: string;
  workspaceId: string;
  sequence: number;
  state: Record<string, unknown>;
  participants: WorkspaceParticipant[];
  createdAt: string;
  parentSnapshotId?: string;
}

export interface WorkspaceOperation {
  id: string;
  sequence: number;
  actorId: string;
  type: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export class PersistentWorkspace {
  private sequence = 0;
  private state: Record<string, unknown> = {};
  private status: WorkspaceStatus = "active";
  private readonly participants = new Map<string, WorkspaceParticipant>();
  private readonly operations: WorkspaceOperation[] = [];
  private readonly snapshots = new Map<string, WorkspaceSnapshot>();
  private latestSnapshotId?: string;

  constructor(readonly id: string = randomUUID()) {}

  join(input: { id: string; kind: ParticipantKind; parentAgentId?: string }): WorkspaceParticipant {
    if (!input.id.trim()) throw new Error("participant id is required");
    if (input.parentAgentId) {
      const parent = this.participants.get(input.parentAgentId);
      if (!parent || (parent.kind !== "agent" && parent.kind !== "subagent")) throw new Error("subagent parent must already exist");
    }
    const participant: WorkspaceParticipant = { ...input, joinedAt: new Date().toISOString() };
    this.participants.set(input.id, participant);
    return structuredClone(participant);
  }

  apply(actorId: string, type: string, payload: Record<string, unknown>, reducer: (state: Record<string, unknown>, operation: WorkspaceOperation) => Record<string, unknown>): WorkspaceOperation {
    this.requireActive();
    if (!this.participants.has(actorId)) throw new Error("actor is not a workspace participant");
    if (!type.trim()) throw new Error("operation type is required");
    const operation: WorkspaceOperation = { id: randomUUID(), sequence: ++this.sequence, actorId, type, payload: structuredClone(payload), occurredAt: new Date().toISOString() };
    this.state = structuredClone(reducer(structuredClone(this.state), operation));
    this.operations.push(operation);
    return structuredClone(operation);
  }

  snapshot(): WorkspaceSnapshot {
    const payload = {
      workspaceId: this.id,
      sequence: this.sequence,
      state: this.state,
      participants: [...this.participants.values()].sort((a, b) => a.id.localeCompare(b.id)),
      parentSnapshotId: this.latestSnapshotId ?? null,
    };
    const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const snapshot: WorkspaceSnapshot = {
      id: `snapshot_${digest.slice(0, 20)}`,
      digest,
      workspaceId: this.id,
      sequence: this.sequence,
      state: structuredClone(this.state),
      participants: structuredClone(payload.participants),
      createdAt: new Date().toISOString(),
      ...(this.latestSnapshotId ? { parentSnapshotId: this.latestSnapshotId } : {}),
    };
    this.snapshots.set(snapshot.id, structuredClone(snapshot));
    this.latestSnapshotId = snapshot.id;
    return snapshot;
  }

  restore(snapshotId: string): WorkspaceSnapshot {
    this.requireActive();
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) throw new Error(`unknown snapshot: ${snapshotId}`);
    this.sequence = snapshot.sequence;
    this.state = structuredClone(snapshot.state);
    this.participants.clear();
    for (const participant of snapshot.participants) this.participants.set(participant.id, structuredClone(participant));
    this.latestSnapshotId = snapshot.id;
    this.operations.splice(0, this.operations.length, ...this.operations.filter((operation) => operation.sequence <= snapshot.sequence));
    return structuredClone(snapshot);
  }

  fork(snapshotId: string, newWorkspaceId = randomUUID()): PersistentWorkspace {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) throw new Error(`unknown snapshot: ${snapshotId}`);
    const child = new PersistentWorkspace(newWorkspaceId);
    child.sequence = snapshot.sequence;
    child.state = structuredClone(snapshot.state);
    for (const participant of snapshot.participants) child.participants.set(participant.id, structuredClone(participant));
    return child;
  }

  pause(): void { this.requireActive(); this.status = "paused"; }
  resume(): void { if (this.status !== "paused") throw new Error("workspace is not paused"); this.status = "active"; }
  complete(): void { this.requireActive(); this.status = "completed"; }
  cancel(): void { if (this.status === "completed") throw new Error("completed workspace cannot be cancelled"); this.status = "cancelled"; }

  view() {
    return {
      id: this.id,
      status: this.status,
      sequence: this.sequence,
      state: structuredClone(this.state),
      participants: structuredClone([...this.participants.values()]),
      operations: structuredClone(this.operations),
      latestSnapshotId: this.latestSnapshotId ?? null,
    };
  }

  private requireActive(): void {
    if (this.status !== "active") throw new Error(`workspace is not active: ${this.status}`);
  }
}
