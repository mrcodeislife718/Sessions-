export type ExecutionOutcome = {
  operation: string;
  actor?: string;
  success: boolean;
  recovered?: boolean;
  replayable?: boolean;
  durationMs: number;
  computeCostUsd?: number;
  cacheHit?: boolean;
  verificationKey?: string;
};

export class EngineeringReliabilityLedger {
  private readonly outcomes: ExecutionOutcome[] = [];
  private readonly verified = new Map<string, { value: unknown; expiresAt: number }>();

  record(outcome: ExecutionOutcome): void {
    if (outcome.durationMs < 0) throw new Error("durationMs must be non-negative");
    this.outcomes.push({ ...outcome });
  }

  rememberVerification(key: string, value: unknown, ttlMs: number, now = Date.now()): void {
    this.verified.set(key, { value, expiresAt: now + Math.max(0, ttlMs) });
  }

  reuseVerification<T>(key: string, now = Date.now()): T | undefined {
    const item = this.verified.get(key);
    if (!item || item.expiresAt < now) {
      this.verified.delete(key);
      return undefined;
    }
    return item.value as T;
  }

  metrics() {
    const total = this.outcomes.length;
    const failed = this.outcomes.filter((item) => !item.success).length;
    const recovered = this.outcomes.filter((item) => item.recovered).length;
    const replayable = this.outcomes.filter((item) => item.replayable).length;
    const cacheHits = this.outcomes.filter((item) => item.cacheHit).length;
    const costUsd = this.outcomes.reduce((sum, item) => sum + (item.computeCostUsd ?? 0), 0);
    return {
      total,
      failed,
      recovered,
      replayCoverage: total === 0 ? 0 : replayable / total,
      cacheHitRate: total === 0 ? 0 : cacheHits / total,
      costUsd,
      costPerSuccessfulExecution: total - failed === 0 ? 0 : costUsd / (total - failed),
    };
  }
}

export async function runWithRecovery<T>(input: {
  operation: string;
  execute: () => Promise<T>;
  recover?: () => Promise<T>;
  verify?: (value: T) => boolean | Promise<boolean>;
  ledger?: EngineeringReliabilityLedger;
  computeCostUsd?: number;
}): Promise<T> {
  const started = Date.now();
  try {
    const value = await input.execute();
    if (input.verify && !(await input.verify(value))) throw new Error("verification failed");
    input.ledger?.record({ operation: input.operation, success: true, replayable: true, durationMs: Date.now() - started, computeCostUsd: input.computeCostUsd });
    return value;
  } catch (error) {
    if (!input.recover) {
      input.ledger?.record({ operation: input.operation, success: false, replayable: true, durationMs: Date.now() - started, computeCostUsd: input.computeCostUsd });
      throw error;
    }
    const value = await input.recover();
    if (input.verify && !(await input.verify(value))) throw new Error("recovery verification failed");
    input.ledger?.record({ operation: input.operation, success: true, recovered: true, replayable: true, durationMs: Date.now() - started, computeCostUsd: input.computeCostUsd });
    return value;
  }
}
