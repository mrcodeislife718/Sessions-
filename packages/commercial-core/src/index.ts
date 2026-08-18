export type PlanKey = "free" | "developer" | "team" | "business" | "enterprise";
export type SubscriptionStatus = "trialing" | "active" | "past_due" | "paused" | "canceled";

export type UsageDimension =
  | "runner_seconds"
  | "verification_seconds"
  | "artifact_bytes_month"
  | "repository_bytes_month"
  | "semantic_index_bytes_month"
  | "ai_input_tokens"
  | "ai_output_tokens"
  | "deployment_minutes"
  | "retained_event_bytes_month"
  | "egress_bytes";

export interface PlanEntitlements {
  hostedRepositories: boolean;
  synchronization: boolean;
  organizations: boolean;
  changeReviews: boolean;
  managedRunners: boolean;
  deployments: boolean;
  semanticIntelligence: boolean;
  advancedGovernance: boolean;
  privateRunners: boolean;
  enterpriseIdentity: boolean;
  customRetention: boolean;
}

export interface PlanLimits {
  hostedRepositories: number | null;
  runnerSecondsMonthly: number | null;
  storageBytes: number | null;
  retainedEventBytes: number | null;
}

export interface CommercialPlan {
  key: PlanKey;
  name: string;
  entitlements: PlanEntitlements;
  limits: PlanLimits;
}

const no = false;
const yes = true;
const GB = 1024 ** 3;

export const plans: Record<PlanKey, CommercialPlan> = {
  free: { key: "free", name: "Local", entitlements: { hostedRepositories:no,synchronization:no,organizations:no,changeReviews:no,managedRunners:no,deployments:no,semanticIntelligence:no,advancedGovernance:no,privateRunners:no,enterpriseIdentity:no,customRetention:no }, limits: { hostedRepositories:0, runnerSecondsMonthly:0, storageBytes:0, retainedEventBytes:0 } },
  developer: { key: "developer", name: "Developer Cloud", entitlements: { hostedRepositories:yes,synchronization:yes,organizations:no,changeReviews:yes,managedRunners:yes,deployments:yes,semanticIntelligence:yes,advancedGovernance:no,privateRunners:no,enterpriseIdentity:no,customRetention:no }, limits: { hostedRepositories:10, runnerSecondsMonthly:36_000, storageBytes:25*GB, retainedEventBytes:5*GB } },
  team: { key: "team", name: "Team", entitlements: { hostedRepositories:yes,synchronization:yes,organizations:yes,changeReviews:yes,managedRunners:yes,deployments:yes,semanticIntelligence:yes,advancedGovernance:yes,privateRunners:no,enterpriseIdentity:no,customRetention:no }, limits: { hostedRepositories:100, runnerSecondsMonthly:360_000, storageBytes:250*GB, retainedEventBytes:50*GB } },
  business: { key: "business", name: "Business", entitlements: { hostedRepositories:yes,synchronization:yes,organizations:yes,changeReviews:yes,managedRunners:yes,deployments:yes,semanticIntelligence:yes,advancedGovernance:yes,privateRunners:yes,enterpriseIdentity:no,customRetention:yes }, limits: { hostedRepositories:1000, runnerSecondsMonthly:1_800_000, storageBytes:2_000*GB, retainedEventBytes:500*GB } },
  enterprise: { key: "enterprise", name: "Enterprise", entitlements: { hostedRepositories:yes,synchronization:yes,organizations:yes,changeReviews:yes,managedRunners:yes,deployments:yes,semanticIntelligence:yes,advancedGovernance:yes,privateRunners:yes,enterpriseIdentity:yes,customRetention:yes }, limits: { hostedRepositories:null, runnerSecondsMonthly:null, storageBytes:null, retainedEventBytes:null } },
};

export interface UsageEventInput {
  id: string;
  billingAccountId: string;
  workspaceId: string;
  repositoryId?: string;
  sessionId?: string;
  dimension: UsageDimension;
  quantity: number;
  unit: string;
  occurredAt: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export function validateUsageEvent(input: UsageEventInput): UsageEventInput {
  if (!input.id.trim()) throw new Error("usage event id is required");
  if (!input.billingAccountId.trim()) throw new Error("billing account id is required");
  if (!input.workspaceId.trim()) throw new Error("workspace id is required");
  if (!input.idempotencyKey.trim()) throw new Error("idempotency key is required");
  if (!Number.isFinite(input.quantity) || input.quantity < 0) throw new Error("usage quantity must be a non-negative finite number");
  return input;
}

export function hasEntitlement(planKey: PlanKey, entitlement: keyof PlanEntitlements): boolean {
  return plans[planKey].entitlements[entitlement];
}

export function subscriptionAllowsService(status: SubscriptionStatus): boolean {
  return status === "trialing" || status === "active";
}

const transitions: Record<SubscriptionStatus, readonly SubscriptionStatus[]> = {
  trialing: ["active", "past_due", "canceled"],
  active: ["past_due", "paused", "canceled"],
  past_due: ["active", "paused", "canceled"],
  paused: ["active", "canceled"],
  canceled: [],
};

export function assertSubscriptionTransition(from: SubscriptionStatus, to: SubscriptionStatus): void {
  if (from === to) return;
  if (!transitions[from].includes(to)) throw new Error(`invalid subscription transition: ${from} -> ${to}`);
}

export type QuotaMetric = keyof PlanLimits;
export function quotaDecision(planKey: PlanKey, metric: QuotaMetric, current: number, requested = 1): { allowed: boolean; limit: number | null; projected: number } {
  if (!Number.isFinite(current) || current < 0 || !Number.isFinite(requested) || requested < 0) throw new Error("quota usage must be non-negative finite numbers");
  const limit = plans[planKey].limits[metric];
  const projected = current + requested;
  return { allowed: limit === null || projected <= limit, limit, projected };
}

export function effectivePlan(accountPlan: PlanKey, subscriptionStatus: SubscriptionStatus): PlanKey {
  return subscriptionAllowsService(subscriptionStatus) ? accountPlan : "free";
}
