export type SessionsEconomicEvent = {
  type: 'paid_team' | 'active_repo' | 'recovery' | 'handoff' | 'revenue' | 'compute_cost' | 'retained_team';
  teamId?: string;
  repoId?: string;
  hoursRecovered?: number;
  amountUsd?: number;
};

export class SessionsEconomicProductionLedger {
  private readonly events: SessionsEconomicEvent[] = [];
  record(event: SessionsEconomicEvent): void { this.events.push(structuredClone(event)); }
  metrics() {
    const uniqueTeams = (type: SessionsEconomicEvent['type']) => new Set(this.events.filter(e => e.type === type).map(e => e.teamId).filter(Boolean)).size;
    const activeRepos = new Set(this.events.filter(e => e.type === 'active_repo').map(e => e.repoId).filter(Boolean)).size;
    const recoveredHours = this.events.reduce((s, e) => s + (e.hoursRecovered ?? 0), 0);
    const revenue = this.events.filter(e => e.type === 'revenue').reduce((s, e) => s + (e.amountUsd ?? 0), 0);
    const computeCost = this.events.filter(e => e.type === 'compute_cost').reduce((s, e) => s + (e.amountUsd ?? 0), 0);
    const paidTeams = uniqueTeams('paid_team');
    const retainedTeams = uniqueTeams('retained_team');
    return {
      paidTeams,
      retainedTeams,
      activeRepos,
      recoveredHours,
      revenueUsd: revenue,
      computeCostUsd: computeCost,
      grossContributionUsd: revenue - computeCost,
      recoveredHoursPerComputeDollar: computeCost === 0 ? 0 : recoveredHours / computeCost,
      teamRetentionRate: paidTeams === 0 ? 0 : retainedTeams / paidTeams,
    };
  }
}

export function sessionsEconomicProductionGate(metrics: ReturnType<SessionsEconomicProductionLedger['metrics']>) {
  const checks = {
    payingTeams: metrics.paidTeams > 0,
    realRepositories: metrics.activeRepos > 0,
    measuredContinuityValue: metrics.recoveredHours > 0,
    positiveGrossContribution: metrics.grossContributionUsd > 0,
    repeatableDemand: metrics.paidTeams >= 5,
    retentionSignal: metrics.paidTeams < 3 || metrics.teamRetentionRate >= 0.5,
  };
  return { productive: Object.values(checks).every(Boolean), checks, metrics };
}
