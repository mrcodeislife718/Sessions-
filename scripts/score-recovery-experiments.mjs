#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/score-recovery-experiments.mjs <experiments.json>");
  process.exit(2);
}

const experiments = JSON.parse(await readFile(file, "utf8"));
if (!Array.isArray(experiments) || experiments.length === 0) throw new Error("experiments.json must contain a non-empty array");

function mean(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function median(values) {
  const sorted = [...values].sort((a,b) => a-b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function summarize(rows) {
  return {
    n: rows.length,
    meanOrientationMs: mean(rows.map((row) => row.orientationMs)),
    medianOrientationMs: median(rows.map((row) => row.orientationMs)),
    meanMissingContext: mean(rows.map((row) => row.missingContextCount)),
    reproductionSuccessRate: mean(rows.map((row) => row.reproductionSuccess ? 1 : 0)),
    continuationReadyRate: mean(rows.map((row) => row.continuationReady ? 1 : 0)),
    meanReconstructionAccuracy: mean(rows.map((row) => row.reconstructionAccuracy)),
  };
}

for (const row of experiments) {
  for (const key of ["system", "orientationMs", "missingContextCount", "reproductionSuccess", "continuationReady", "reconstructionAccuracy"]) {
    if (!(key in row)) throw new Error(`missing ${key}`);
  }
  if (row.orientationMs < 0 || row.missingContextCount < 0 || row.reconstructionAccuracy < 0 || row.reconstructionAccuracy > 1) throw new Error("invalid experiment metric");
}

const groups = Object.groupBy(experiments, (row) => row.system);
const output = Object.fromEntries(Object.entries(groups).map(([key, rows]) => [key, summarize(rows)]));

if (output.sessions && output.baseline) {
  output.comparison = {
    orientationReductionFraction: 1 - (output.sessions.meanOrientationMs / output.baseline.meanOrientationMs),
    missingContextReduction: output.baseline.meanMissingContext - output.sessions.meanMissingContext,
    reproductionSuccessDelta: output.sessions.reproductionSuccessRate - output.baseline.reproductionSuccessRate,
    continuationReadyDelta: output.sessions.continuationReadyRate - output.baseline.continuationReadyRate,
    reconstructionAccuracyDelta: output.sessions.meanReconstructionAccuracy - output.baseline.meanReconstructionAccuracy,
  };
}

console.log(JSON.stringify(output, null, 2));
