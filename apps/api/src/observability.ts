export type LogLevel = "info" | "warn" | "error";

const counters = new Map<string, number>();
const startedAt = Date.now();

export function incrementMetric(name: string, amount = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + amount);
}

export function structuredLog(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    service: "sessions-api",
    event,
    ...fields,
  };
  const line = JSON.stringify(record);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function prometheusMetrics(): string {
  const lines = [
    "# HELP sessions_api_uptime_seconds Process uptime in seconds.",
    "# TYPE sessions_api_uptime_seconds gauge",
    `sessions_api_uptime_seconds ${Math.floor((Date.now() - startedAt) / 1000)}`,
  ];
  for (const [name, value] of [...counters.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const metric = `sessions_api_${name.replace(/[^a-zA-Z0-9_:]/g, "_")}`;
    lines.push(`# TYPE ${metric} counter`, `${metric} ${value}`);
  }
  return `${lines.join("\n")}\n`;
}
