import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { checkoutParams, verifyStripeSignature } from "./stripe.js";

test("Stripe signatures are verified against raw payload and timestamp", () => {
  const secret = "whsec_test";
  const now = 1_800_000_000;
  const payload = Buffer.from(JSON.stringify({ id: "evt_1", type: "invoice.paid", data: { object: {} } }));
  const signature = createHmac("sha256", secret).update(`${now}.${payload.toString("utf8")}`).digest("hex");
  assert.equal(verifyStripeSignature(payload, `t=${now},v1=${signature}`, secret, 300, now).id, "evt_1");
  assert.throws(() => verifyStripeSignature(Buffer.from("{}"), `t=${now},v1=${signature}`, secret, 300, now));
  assert.throws(() => verifyStripeSignature(payload, `t=${now - 301},v1=${signature}`, secret, 300, now));
});

test("Checkout is subscription-mode and carries workspace reconciliation metadata", () => {
  const params = checkoutParams({
    priceId: "price_developer",
    workspaceId: "workspace_1",
    planKey: "developer",
    successUrl: "https://sessions.example/billing/success?session_id={CHECKOUT_SESSION_ID}",
    cancelUrl: "https://sessions.example/billing/cancelled",
  });
  assert.equal(params.get("mode"), "subscription");
  assert.equal(params.get("line_items[0][price]"), "price_developer");
  assert.equal(params.get("metadata[workspace_id]"), "workspace_1");
  assert.equal(params.get("subscription_data[metadata][plan_key]"), "developer");
});
