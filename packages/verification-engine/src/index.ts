import type { ActorIdentity } from "@sessions/shared";

export type VerificationKind = "lint" | "typecheck" | "test" | "build" | "security" | "policy" | "custom";
export type VerificationStatus = "passed" | "failed" | "error" | "requires_review";

export interface VerificationEvidence {
  id: string;
  sessionId: string;
  snapshotId?: string;
  kind: VerificationKind;
  status: VerificationStatus;
  requestedBy: ActorIdentity;
  command?: string;
  startedAt: string;
  finishedAt: string;
  exitCode?: number;
  summary: string;
  evidenceRef?: string;
  metadata?: Record<string, unknown>;
}

export interface ReleaseGateResult {
  allowed: boolean;
  blockingEvidence: VerificationEvidence[];
  reviewEvidence: VerificationEvidence[];
}

export function evaluateReleaseGate(evidence: VerificationEvidence[]): ReleaseGateResult {
  const blockingEvidence = evidence.filter((item) => item.status === "failed" || item.status === "error");
  const reviewEvidence = evidence.filter((item) => item.status === "requires_review");
  return {
    allowed: blockingEvidence.length === 0 && reviewEvidence.length === 0,
    blockingEvidence,
    reviewEvidence,
  };
}

export function createVerificationEvidence(input: Omit<VerificationEvidence, "id">): VerificationEvidence {
  const material = [input.sessionId, input.snapshotId ?? "", input.kind, input.startedAt, input.finishedAt, input.summary].join(":");
  const id = `verification_${Buffer.from(material).toString("base64url").slice(0, 24)}`;
  return { ...input, id };
}
