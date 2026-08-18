import assert from "node:assert/strict";
import test from "node:test";
import { assertSubscriptionTransition, effectivePlan, hasEntitlement, quotaDecision, subscriptionAllowsService } from "./index.js";

test("paid plans expose only their declared entitlements", () => {
  assert.equal(hasEntitlement("developer", "hostedRepositories"), true);
  assert.equal(hasEntitlement("developer", "organizations"), false);
  assert.equal(hasEntitlement("enterprise", "enterpriseIdentity"), true);
});

test("payment failure removes paid service until recovered", () => {
  assert.equal(subscriptionAllowsService("active"), true);
  assert.equal(subscriptionAllowsService("past_due"), false);
  assert.equal(effectivePlan("team", "past_due"), "free");
  assert.equal(effectivePlan("team", "active"), "team");
});

test("subscription transitions reject resurrection after cancellation", () => {
  assert.doesNotThrow(() => assertSubscriptionTransition("active", "past_due"));
  assert.doesNotThrow(() => assertSubscriptionTransition("past_due", "active"));
  assert.throws(() => assertSubscriptionTransition("canceled", "active"), /invalid subscription transition/);
});

test("quota decisions enforce finite plans and allow enterprise unlimited usage", () => {
  assert.deepEqual(quotaDecision("developer", "hostedRepositories", 9, 1), { allowed: true, limit: 10, projected: 10 });
  assert.deepEqual(quotaDecision("developer", "hostedRepositories", 10, 1), { allowed: false, limit: 10, projected: 11 });
  assert.equal(quotaDecision("enterprise", "storageBytes", 10 ** 12, 10 ** 12).allowed, true);
});
