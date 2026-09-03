import http from "node:http";
import { createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";

const billingUrl = process.env.BILLING_URL ?? "http://127.0.0.1:4100";
const sessionsApiUrl = process.env.SESSIONS_API_QUALIFICATION_URL ?? "http://127.0.0.1:4000";
const token = process.env.BILLING_TEST_TOKEN ?? "sessions-billing-test-token";
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "whsec_qualification";
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://sessions:sessions@localhost:5432/sessions";
const mockPort = Number(process.env.STRIPE_MOCK_PORT ?? 4242);
const stripeCalls = [];

function assert(condition, message) { if (!condition) throw new Error(message); }
function psql(sql, expectSuccess = true) {
  const run = spawnSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-Atc", sql], { encoding: "utf8" });
  if (expectSuccess && run.status !== 0) throw new Error(`psql failed: ${run.stderr}`);
  if (!expectSuccess && run.status === 0) throw new Error("expected database operation to be rejected");
  return run.stdout.trim();
}

async function authenticatedFetch(base, path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(`${base}${path}`, { ...init, headers });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  return { response, body };
}

async function api(path, init = {}) {
  const result = await authenticatedFetch(billingUrl, path, init);
  if (!result.response.ok) throw new Error(`${path} failed (${result.response.status}): ${JSON.stringify(result.body)}`);
  return result;
}

async function createSession(objective) {
  return authenticatedFetch(sessionsApiUrl, "/api/sessions", {
    method: "POST",
    body: JSON.stringify({ repositoryId: "repo_billing_qualification", projectId: "project_billing", objective }),
  });
}

async function webhook(event) {
  const payload = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", webhookSecret).update(`${timestamp}.${payload}`).digest("hex");
  const response = await fetch(`${billingUrl}/webhooks/stripe`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": `t=${timestamp},v1=${signature}` },
    body: payload,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`webhook failed (${response.status}): ${JSON.stringify(body)}`);
  return body;
}

const stripeMock = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const body = Buffer.concat(chunks).toString("utf8");
  stripeCalls.push({ method: req.method, path: req.url, body });
  res.setHeader("content-type", "application/json");
  if (req.method === "POST" && req.url === "/v1/checkout/sessions") {
    res.end(JSON.stringify({ id: "cs_qualification", url: "https://checkout.stripe.invalid/cs_qualification" }));
    return;
  }
  if (req.method === "POST" && req.url === "/v1/subscriptions/sub_qualification") {
    res.end(JSON.stringify({ id: "sub_qualification", cancel_at_period_end: true }));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: { message: "unexpected mock Stripe request" } }));
});

await new Promise((resolve, reject) => {
  stripeMock.once("error", reject);
  stripeMock.listen(mockPort, "127.0.0.1", resolve);
});

try {
  const checkout = await api("/api/billing/checkout", { method: "POST", body: JSON.stringify({ planKey: "developer" }) });
  assert(checkout.body.url === "https://checkout.stripe.invalid/cs_qualification", "checkout URL was not returned");
  assert(stripeCalls[0]?.body.includes("mode=subscription"), "Checkout was not created in subscription mode");
  assert(stripeCalls[0]?.body.includes("metadata%5Bworkspace_id%5D=workspace_billing_qualification"), "workspace metadata missing from Checkout");

  const checkoutEvent = {
    id: "evt_checkout_qualification",
    type: "checkout.session.completed",
    created: 1_800_000_100,
    livemode: false,
    data: { object: { id: "cs_qualification", status: "complete", customer: "cus_qualification", subscription: "sub_qualification", metadata: { workspace_id: "workspace_billing_qualification", plan_key: "developer" } } },
  };
  assert((await webhook(checkoutEvent)).result === "processed", "checkout webhook not processed");
  assert((await webhook(checkoutEvent)).result === "duplicate", "duplicate Stripe event was not deduplicated");
  assert(psql("select external_customer_ref from billing_accounts where workspace_id='workspace_billing_qualification'") === "cus_qualification", "checkout did not link Stripe customer identity");
  assert(psql("select count(*) from subscriptions where external_subscription_ref='sub_qualification'") === "0", "checkout session was incorrectly persisted as an authoritative subscription");
  assert(psql("select status from workspace_entitlements where workspace_id='workspace_billing_qualification'") !== "active", "checkout completion incorrectly granted paid entitlement");

  await webhook({
    id: "evt_subscription_qualification",
    type: "customer.subscription.created",
    created: 1_800_000_150,
    livemode: false,
    data: { object: {
      id: "sub_qualification",
      status: "active",
      customer: "cus_qualification",
      current_period_start: 1_800_000_000,
      current_period_end: 1_802_592_000,
      cancel_at_period_end: false,
      metadata: { workspace_id: "workspace_billing_qualification", plan_key: "developer" },
    } },
  });
  assert(psql("select status from workspace_entitlements where workspace_id='workspace_billing_qualification'") === "active", "authoritative subscription event did not activate entitlement");
  assert(psql("select status from subscriptions where external_subscription_ref='sub_qualification'") === "active", "authoritative subscription row was not persisted");

  await webhook({ id: "evt_failed_qualification", type: "invoice.payment_failed", created: 1_800_000_300, livemode: false, data: { object: { id: "in_failed", customer: "cus_qualification", subscription: "sub_qualification" } } });
  assert(psql("select status from workspace_entitlements where workspace_id='workspace_billing_qualification'") === "payment_failed", "payment failure did not suspend writes");
  psql("insert into sessions(id,workspace_id,project_id,repository_id,objective) values('session_should_fail','workspace_billing_qualification','project_billing','repo_billing_qualification','must be blocked')", false);
  const suspendedApiWrite = await createSession("API write must be suspended");
  assert(suspendedApiWrite.response.status === 402, `suspended API write returned ${suspendedApiWrite.response.status} instead of 402`);
  assert(String(suspendedApiWrite.body?.error ?? "").includes("billing entitlement"), "suspended API write did not return an actionable billing error");

  await webhook({ id: "evt_stale_paid_qualification", type: "invoice.paid", created: 1_800_000_200, livemode: false, data: { object: { id: "in_stale_paid", status: "paid", customer: "cus_qualification", subscription: "sub_qualification" } } });
  assert(psql("select status from workspace_entitlements where workspace_id='workspace_billing_qualification'") === "payment_failed", "older out-of-order paid event incorrectly restored entitlement");
  const staleApiWrite = await createSession("Stale Stripe event must not restore writes");
  assert(staleApiWrite.response.status === 402, "out-of-order stale event incorrectly restored API writes");

  await webhook({ id: "evt_paid_qualification", type: "invoice.paid", created: 1_800_000_400, livemode: false, data: { object: { id: "in_paid", status: "paid", customer: "cus_qualification", subscription: "sub_qualification" } } });
  assert(psql("select status from workspace_entitlements where workspace_id='workspace_billing_qualification'") === "active", "newer successful payment did not restore entitlement");
  const recoveredApiWrite = await createSession("API writes restored after payment recovery");
  assert(recoveredApiWrite.response.status === 201, `recovered API write returned ${recoveredApiWrite.response.status} instead of 201`);
  const recoveredSessionId = recoveredApiWrite.body?.session?.id;
  assert(recoveredSessionId, "recovered API write did not return a Session id");

  const exported = await api("/api/account/export", { method: "POST", body: "{}" });
  assert(exported.body.schemaVersion === 2, "export schema version was not advanced");
  assert(exported.body.workspace?.id === "workspace_billing_qualification", "export did not contain workspace data");
  assert(exported.body.sessions?.some((session) => session.id === recoveredSessionId), "export did not include the recovered API-created Session");
  assert(Array.isArray(exported.body.snapshots) && Array.isArray(exported.body.verifications), "export did not include recovery and verification collections");
  assert(Array.isArray(exported.body.billingAccounts) && Array.isArray(exported.body.entitlements), "export did not include account and entitlement state");
  assert((exported.response.headers.get("content-disposition") ?? "").includes("attachment"), "export is not downloadable");

  const cancellation = await api("/api/account/cancel", { method: "POST", body: "{}" });
  assert(cancellation.body.cancelAtPeriodEnd === true, "cancellation was not scheduled at period end");
  const cancelCall = stripeCalls.find((call) => call.path === "/v1/subscriptions/sub_qualification");
  assert(cancelCall?.body.includes("cancel_at_period_end=true"), "Stripe cancellation request did not preserve access through period end");

  const billing = await api("/api/billing/subscription");
  assert(billing.body.external_customer_ref === "cus_qualification", "Stripe customer was not reconciled");
  assert(billing.body.external_subscription_ref === "sub_qualification", "Stripe subscription was not reconciled");
  assert(billing.body.entitlement_status === "active", "billing status does not expose active entitlement");

  assert(psql("select count(*) from stripe_events") === "5", "Stripe event ledger count is incorrect");
  assert(psql("select count(*) from cancellation_records where billing_account_id='billing_billing_qualification'") === "1", "cancellation record missing");
  assert(psql("select status from data_export_requests where workspace_id='workspace_billing_qualification' order by requested_at desc limit 1") === "ready", "export request did not reach ready state");
  assert(Number(psql("select count(*) from audit_events where workspace_id='workspace_billing_qualification' and outcome='denied'")) >= 2, "billing-suspended API denials were not audited");

  console.log(JSON.stringify({ qualification: "billing-control-plane", passed: true, stripeEvents: 5, checkoutDoesNotGrantEntitlement: true, authoritativeSubscriptionActivation: true, duplicateSafety: true, outOfOrderSafety: true, entitlementRecovery: true, apiPaymentResponse: 402, export: true, cancellation: true }, null, 2));
} finally {
  await new Promise((resolve) => stripeMock.close(resolve));
}