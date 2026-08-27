import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionsEconomicProductionLedger, sessionsEconomicProductionGate } from './economic-production.js';

test('Sessions production gate requires paid teams, real repos, recovered time and contribution', () => {
  const ledger = new SessionsEconomicProductionLedger();
  for (let i = 0; i < 5; i += 1) {
    ledger.record({ type: 'paid_team', teamId: `t${i}` });
    ledger.record({ type: 'retained_team', teamId: `t${i}` });
    ledger.record({ type: 'active_repo', repoId: `r${i}` });
    ledger.record({ type: 'recovery', teamId: `t${i}`, hoursRecovered: 5 });
    ledger.record({ type: 'revenue', teamId: `t${i}`, amountUsd: 500 });
    ledger.record({ type: 'compute_cost', teamId: `t${i}`, amountUsd: 50 });
  }
  const result = sessionsEconomicProductionGate(ledger.metrics());
  assert.equal(result.productive, true);
  assert.equal(result.metrics.paidTeams, 5);
  assert.equal(result.metrics.recoveredHours, 25);
});
