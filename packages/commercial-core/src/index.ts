export type PlanKey = "free" | "developer" | "team" | "business" | "enterprise";

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

export interface CommercialPlan {
  key: PlanKey;
  name: string;
  entitlements: PlanEntitlements;
}

const no = false;
const yes = true;

export const plans: Record<PlanKey, CommercialPlan> = {
  free: {
    key: "free",
    name: "Local",
    entitlements: {
      hostedRepositories: no,
      synchronization: no,
      organizations: no,
      changeReviews: no,
      managedRunners: no,
      deployments: no,
      semanticIntelligence: no,
      advancedGovernance: no,
      privateRunners: no,
      enterpriseIdentity: no,
      customRetention: no,
    },
  },
  developer: {
    key: "developer",
    name: "Developer Cloud",
    entitlements: {
      hostedRepositories: yes,
      synchronization: yes,
      organizations: no,
      changeReviews: yes,
      managedRunners: yes,
      deployments: yes,
      semanticIntelligence: yes,
      advancedGovernance: no,
      privateRunners: no,
      enterpriseIdentity: no,
      customRetention: no,
    },
  },
  team: {
    key: "team",
    name: "Team",
    entitlements: {
      hostedRepositories: yes,
      synchronization: yes,
      organizations: yes,
      changeReviews: yes,
      managedRunners: yes,
      deployments: yes,
      semanticIntelligence: yes,
      advancedGovernance: yes,
      privateRunners: no,
      enterpriseIdentity: no,
      customRetention: no,
    },
  },
  business: {
    key: "business",
    name: "Business",
    entitlements: {
      hostedRepositories: yes,
      synchronization: yes,
      organizations: yes,
      changeReviews: yes,
      managedRunners: yes,
      deployments: yes,
      semanticIntelligence: yes,
      advancedGovernance: yes,
      privateRunners: yes,
      enterpriseIdentity: no,
      customRetention: yes,
    },
  },
  enterprise: {
    key: "enterprise",
    name: "Enterprise",
    entitlements: {
      hostedRepositories: yes,
      synchronization: yes,
      organizations: yes,
      changeReviews: yes,
      managedRunners: yes,
      deployments: yes,
      semanticIntelligence: yes,
      advancedGovernance: yes,
      privateRunners: yes,
      enterpriseIdentity: yes,
      customRetention: yes,
    },
  },
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
