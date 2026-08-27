import { sessionsEconomicSnapshot } from './economic-production.js';

export type LogLevel = 'info' | 'warn' | 'error';

const counters = new Map<string, number>();
const startedAt = Date.now();

export function incrementMetric(name: string, amount = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + amount);
}

export function structuredLog(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    service: 'sessions-api',
    event,
    ...fields,
  };
  const line = JSON.stringify(record);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export function prometheusMetrics(): string {
  const economic = sessionsEconomicSnapshot();
  const m = economic.metrics;
  const lines = [
    '# HELP sessions_api_uptime_seconds Process uptime in seconds.',
    '# TYPE sessions_api_uptime_seconds gauge',
    `sessions_api_uptime_seconds ${Math.floor((Date.now() - startedAt) / 1000)}`,
    '# TYPE sessions_economic_paid_teams gauge',
    `sessions_economic_paid_teams ${m.paidTeams}`,
    '# TYPE sessions_economic_active_repositories gauge',
    `sessions_economic_active_repositories ${m.activeRepos}`,
    '# TYPE sessions_economic_recovered_hours gauge',
    `sessions_economic_recovered_hours ${m.recoveredHours}`,
    '# TYPE sessions_economic_revenue_usd gauge',
    `sessions_economic_revenue_usd ${m.revenueUsd}`,
    '# TYPE sessions_economic_compute_cost_usd gauge',
    `sessions_economic_compute_cost_usd ${m.computeCostUsd}`,
    '# TYPE sessions_economic_gross_contribution_usd gauge',
    `sessions_economic_gross_contribution_usd ${m.grossContributionUsd}`,
    '# TYPE sessions_economic_productive gauge',
    `sessions_economic_productive ${economic.productive ? 1 : 0}`,
  ];
  for (const [name, value] of [...counters.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const metric = `sessions_api_${name.replace(/[^a-zA-Z0-9_:]/g, '_')}`;
    lines.push(`# TYPE ${metric} counter`, `${metric} ${value}`);
  }
  return `${lines.join('\n')}\n`;
}
