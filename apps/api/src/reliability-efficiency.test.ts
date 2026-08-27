import test from "node:test";
import assert from "node:assert/strict";
import { EngineeringReliabilityLedger, runWithRecovery } from "./reliability-efficiency.js";

test("recovers safely and records replayable execution", async () => {
  const ledger = new EngineeringReliabilityLedger();
  const value = await runWithRecovery({
    operation: "repository-operation",
    ledger,
    execute: async () => { throw new Error("worker failed"); },
    recover: async () => ({ restored: true }),
    verify: (result) => result.restored === true,
  });
  assert.equal(value.restored, true);
  const metrics = ledger.metrics();
  assert.equal(metrics.recovered, 1);
  assert.equal(metrics.replayCoverage, 1);
});

test("deduplicates stable verification work", () => {
  const ledger = new EngineeringReliabilityLedger();
  ledger.rememberVerification("commit:test", { passed: true }, 1_000, 100);
  assert.equal(ledger.reuseVerification<{ passed: boolean }>("commit:test", 500)?.passed, true);
  assert.equal(ledger.reuseVerification("commit:test", 2_000), undefined);
});
