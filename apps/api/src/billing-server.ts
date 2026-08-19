import http from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { checkoutParams, stripeRequest, verifyStripeSignature, type StripeEvent } from "./stripe.js";

const port = Number(process.env.BILLING_PORT ?? 4100);
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://sessions:sessions@localhost:5432/sessions";
const stripeSecretKey = process.env.STRIPE_SECRET_KEY ?? "";
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
const publicOrigin = process.env.SESSIONS_PUBLIC_ORIGIN ?? "http://localhost:3000";
const maxBody = Number(process.env.SESSIONS_MAX_BODY_BYTES ?? 1_048_576);
const pool = new Pool({ connectionString: databaseUrl, max: Number(process.env.SESSIONS_DB_POOL_MAX ?? 10) });

class HttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

type Identity = { workspaceId: string; principalId: string; scopes: string[] };
type Db = Pool | PoolClient;

function send(res: http.ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...extra });
  res.end(JSON.stringify(body));
}

async function rawBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBody) throw new HttpError(413, "request body too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function jsonBody(req: http.IncomingMessage): Promise<any> {
  const raw = await rawBody(req);
  if (!raw.length) return {};
  try { return JSON.parse(raw.toString("utf8")); }
  catch { throw new HttpError(400, "invalid JSON body"); }
}

function tokenHash(token: string) { return createHash("sha256").update(token).digest("hex"); }
function hasScope(identity: Identity, scope: string) { return identity.scopes.includes("*") || identity.scopes.includes(scope); }
function requireScope(identity: Identity, scope: string) { if (!hasScope(identity, scope)) throw new HttpError(403, `missing scope: ${scope}`); }

async function authenticate(req: http.IncomingMessage): Promise<Identity> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) throw new HttpError(401, "bearer token required");
  const result = await pool.query(
    `select c.workspace_id, c.principal_id, c.scopes
       from api_credentials c
       join principals p on p.id = c.principal_id
      where c.token_hash = $1
        and c.status = 'active'
        and p.status = 'active'
        and (c.expires_at is null or c.expires_at > now())`,
    [tokenHash(auth.slice(7).trim())],
  );
  if (!result.rowCount) throw new HttpError(401, "invalid or expired credential");
  return { workspaceId: result.rows[0].workspace_id, principalId: result.rows[0].principal_id, scopes: result.rows[0].scopes ?? [] };
}

async function billingAccount(db: Db, workspaceId: string) {
  const result = await db.query("select * from billing_accounts where workspace_id=$1", [workspaceId]);
  if (!result.rowCount) throw new HttpError(404, "billing account not found");
  return result.rows[0];
}

async function setEntitlement(db: Db, workspaceId: string, planKey: string, status: string, reason: string | null) {
  await db.query(
    `insert into workspace_entitlements(workspace_id,plan_key,status,source,reason,effective_at,updated_at)
     values($1,$2,$3,'stripe',$4,now(),now())
     on conflict(workspace_id) do update
       set plan_key=excluded.plan_key,status=excluded.status,source='stripe',reason=excluded.reason,effective_at=now(),updated_at=now()`,
    [workspaceId, planKey, status, reason],
  );
}

async function resolveWorkspace(db: Db, object: any) {
  const subscriptionId = typeof object.subscription === "string" ? object.subscription : object.id?.startsWith?.("sub_") ? object.id : object.subscription?.id;
  const customerId = typeof object.customer === "string" ? object.customer : object.customer?.id;
  const metadata = object.metadata ?? object.subscription_details?.metadata ?? {};
  let workspaceId: string | null = metadata.workspace_id ?? null;
  let planKey: string | null = metadata.plan_key ?? null;

  if (!workspaceId && subscriptionId) {
    const found = await db.query(
      `select b.workspace_id,s.plan_key from subscriptions s
       join billing_accounts b on b.id=s.billing_account_id
       where s.external_subscription_ref=$1 limit 1`,
      [subscriptionId],
    );
    if (found.rowCount) { workspaceId = found.rows[0].workspace_id; planKey ??= found.rows[0].plan_key; }
  }
  if (!workspaceId && customerId) {
    const found = await db.query("select workspace_id,plan_key from billing_accounts where external_customer_ref=$1 limit 1", [customerId]);
    if (found.rowCount) { workspaceId = found.rows[0].workspace_id; planKey ??= found.rows[0].plan_key; }
  }
  return { workspaceId, planKey: planKey ?? "developer", subscriptionId, customerId };
}

async function upsertSubscription(db: Db, accountId: string, planKey: string, subscriptionId: string, object: any, eventType: string) {
  const status = object.status ?? (eventType === "customer.subscription.deleted" ? "canceled" : "active");
  const periodStart = object.current_period_start ? new Date(object.current_period_start * 1000) : null;
  const periodEnd = object.current_period_end ? new Date(object.current_period_end * 1000) : null;
  const canceledAt = object.canceled_at ? new Date(object.canceled_at * 1000) : null;
  await db.query(
    `insert into subscriptions(id,billing_account_id,plan_key,status,seats,external_subscription_ref,period_start,period_end,cancel_at_period_end,canceled_at)
     values($1,$2,$3,$4,1,$5,$6,$7,$8,$9)
     on conflict(id) do update
       set plan_key=excluded.plan_key,status=excluded.status,external_subscription_ref=excluded.external_subscription_ref,
           period_start=coalesce(excluded.period_start,subscriptions.period_start),period_end=coalesce(excluded.period_end,subscriptions.period_end),
           cancel_at_period_end=excluded.cancel_at_period_end,canceled_at=coalesce(excluded.canceled_at,subscriptions.canceled_at),updated_at=now()`,
    [`stripe_${subscriptionId}`, accountId, planKey, status, subscriptionId, periodStart, periodEnd, Boolean(object.cancel_at_period_end), canceledAt],
  );
}

async function reconcileStripeEvent(db: Db, event: StripeEvent) {
  const object = event.data.object;
  const { workspaceId, planKey, subscriptionId, customerId } = await resolveWorkspace(db, object);
  if (!workspaceId) return;
  const account = await billingAccount(db, workspaceId);

  if (customerId) {
    await db.query("update billing_accounts set external_provider='stripe',external_customer_ref=$2,updated_at=now() where id=$1", [account.id, customerId]);
  }

  if (subscriptionId && (object.id?.startsWith?.("sub_") || event.type === "checkout.session.completed")) {
    await upsertSubscription(db, account.id, planKey, subscriptionId, object, event.type);
  }

  if (event.type === "invoice.payment_failed") {
    await db.query("update billing_accounts set payment_state='failed',status='past_due',updated_at=now() where id=$1", [account.id]);
    await setEntitlement(db, workspaceId, planKey, "payment_failed", event.type);
    return;
  }

  if (event.type === "customer.subscription.deleted") {
    await db.query("update billing_accounts set status='canceled',updated_at=now() where id=$1", [account.id]);
    await setEntitlement(db, workspaceId, planKey, "canceled", event.type);
    return;
  }

  if (["invoice.paid", "checkout.session.completed", "customer.subscription.created", "customer.subscription.updated"].includes(event.type)) {
    const sourceStatus = object.status ?? "active";
    const entitlementStatus = ["active", "trialing", "complete", "paid"].includes(sourceStatus)
      ? "active"
      : sourceStatus === "past_due" ? "payment_failed" : "suspended";
    await db.query(
      "update billing_accounts set plan_key=$2,payment_state=$3,status=$4,updated_at=now() where id=$1",
      [account.id, planKey, entitlementStatus === "active" ? "ok" : "failed", sourceStatus],
    );
    await setEntitlement(db, workspaceId, planKey, entitlementStatus, event.type);
  }
}

async function handleStripeEvent(event: StripeEvent): Promise<"processed" | "duplicate"> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const inserted = await client.query(
      "insert into stripe_events(id,event_type,livemode,payload) values($1,$2,$3,$4) on conflict(id) do nothing returning id",
      [event.id, event.type, Boolean(event.livemode), JSON.stringify(event)],
    );
    if (!inserted.rowCount) { await client.query("rollback"); return "duplicate"; }
    await reconcileStripeEvent(client, event);
    await client.query("commit");
    return "processed";
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally { client.release(); }
}

async function createExport(identity: Identity) {
  const exportId = `export_${randomUUID()}`;
  await pool.query("insert into data_export_requests(id,workspace_id,requested_by,status) values($1,$2,$3,'processing')", [exportId, identity.workspaceId, identity.principalId]);
  try {
    const [workspace, repositories, sessions, productEvents, auditEvents] = await Promise.all([
      pool.query("select * from workspaces where id=$1", [identity.workspaceId]),
      pool.query("select * from hosted_repositories where workspace_id=$1", [identity.workspaceId]),
      pool.query("select * from sessions where workspace_id=$1", [identity.workspaceId]),
      pool.query("select * from product_events where workspace_id=$1 order by occurred_at", [identity.workspaceId]),
      pool.query("select * from audit_events where workspace_id=$1 order by occurred_at", [identity.workspaceId]),
    ]);
    const sessionIds = sessions.rows.map((row) => row.id);
    const events = sessionIds.length
      ? await pool.query("select * from session_events where session_id=any($1::text[]) order by occurred_at", [sessionIds])
      : { rows: [] };
    const payload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      workspace: workspace.rows[0] ?? null,
      repositories: repositories.rows,
      sessions: sessions.rows,
      sessionEvents: events.rows,
      productEvents: productEvents.rows,
      auditEvents: auditEvents.rows,
    };
    await pool.query("update data_export_requests set status='ready',completed_at=now() where id=$1", [exportId]);
    return { exportId, payload };
  } catch (error) {
    await pool.query("update data_export_requests set status='failed',completed_at=now() where id=$1", [exportId]);
    throw error;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (req.method === "GET" && url.pathname === "/health") {
      await pool.query("select 1");
      return send(res, 200, { ok: true, service: "sessions-billing" });
    }

    if (req.method === "POST" && url.pathname === "/webhooks/stripe") {
      if (!stripeWebhookSecret) throw new HttpError(503, "Stripe webhook secret is not configured");
      const raw = await rawBody(req);
      const signature = String(req.headers["stripe-signature"] ?? "");
      let event: StripeEvent;
      try { event = verifyStripeSignature(raw, signature, stripeWebhookSecret); }
      catch (error) { throw new HttpError(400, error instanceof Error ? error.message : "invalid webhook"); }
      return send(res, 200, { received: true, result: await handleStripeEvent(event) });
    }

    const identity = await authenticate(req);

    if (req.method === "GET" && url.pathname === "/api/billing/subscription") {
      requireScope(identity, "billing:read");
      const result = await pool.query(
        `select b.*,e.status as entitlement_status,e.reason as entitlement_reason,
                s.status as subscription_status,s.external_subscription_ref,s.cancel_at_period_end,s.period_end
           from billing_accounts b
           left join workspace_entitlements e on e.workspace_id=b.workspace_id
           left join lateral (select * from subscriptions where billing_account_id=b.id order by updated_at desc limit 1) s on true
          where b.workspace_id=$1`,
        [identity.workspaceId],
      );
      return send(res, 200, result.rows[0] ?? null);
    }

    if (req.method === "POST" && url.pathname === "/api/billing/checkout") {
      requireScope(identity, "billing:write");
      if (!stripeSecretKey) throw new HttpError(503, "Stripe secret key is not configured");
      const body = await jsonBody(req);
      const planKey = String(body.planKey ?? "developer");
      if (!/^[a-z0-9_]+$/.test(planKey)) throw new HttpError(400, "invalid plan key");
      const priceId = process.env[`STRIPE_PRICE_${planKey.toUpperCase()}`];
      if (!priceId) throw new HttpError(400, `Stripe price is not configured for ${planKey}`);
      const account = await billingAccount(pool, identity.workspaceId);
      const params = checkoutParams({
        priceId,
        workspaceId: identity.workspaceId,
        planKey,
        customerId: account.external_customer_ref,
        successUrl: `${publicOrigin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${publicOrigin}/billing/cancelled`,
      });
      const checkout = await stripeRequest(stripeSecretKey, "checkout/sessions", params);
      await pool.query(
        "insert into billing_events(id,billing_account_id,event_type,external_event_ref,idempotency_key,payload) values($1,$2,'checkout.created',$3,$3,$4) on conflict(idempotency_key) do nothing",
        [`billing_${randomUUID()}`, account.id, checkout.id, JSON.stringify({ checkoutSessionId: checkout.id, planKey })],
      );
      return send(res, 201, { id: checkout.id, url: checkout.url });
    }

    if (req.method === "POST" && url.pathname === "/api/account/export") {
      requireScope(identity, "account:export");
      const { exportId, payload } = await createExport(identity);
      return send(res, 200, payload, { "content-disposition": `attachment; filename="sessions-${identity.workspaceId}-${exportId}.json"` });
    }

    if (req.method === "POST" && url.pathname === "/api/account/cancel") {
      requireScope(identity, "billing:write");
      if (!stripeSecretKey) throw new HttpError(503, "Stripe secret key is not configured");
      const account = await billingAccount(pool, identity.workspaceId);
      const subscription = await pool.query(
        "select * from subscriptions where billing_account_id=$1 and external_subscription_ref is not null order by updated_at desc limit 1",
        [account.id],
      );
      if (!subscription.rowCount) throw new HttpError(409, "no Stripe subscription is attached to this workspace");
      const row = subscription.rows[0];
      await stripeRequest(stripeSecretKey, `subscriptions/${encodeURIComponent(row.external_subscription_ref)}`, new URLSearchParams({ cancel_at_period_end: "true" }));
      const cancellationId = `cancel_${randomUUID()}`;
      await pool.query(
        "insert into cancellation_records(id,billing_account_id,requested_by,reason,effective_at,export_requested) values($1,$2,$3,$4,$5,false)",
        [cancellationId, account.id, identity.principalId, "customer_requested", row.period_end ?? new Date()],
      );
      await pool.query("update subscriptions set cancel_at_period_end=true,updated_at=now() where id=$1", [row.id]);
      return send(res, 202, { cancellationId, status: "requested", cancelAtPeriodEnd: true, effectiveAt: row.period_end ?? null });
    }

    throw new HttpError(404, "not found");
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    console.error(JSON.stringify({ level: "error", service: "sessions-billing", status, error: error instanceof Error ? error.message : String(error) }));
    return send(res, status, { error: status >= 500 ? "internal error" : error instanceof Error ? error.message : "request failed" });
  }
});

server.listen(port, "0.0.0.0", () => console.log(JSON.stringify({ level: "info", service: "sessions-billing", event: "server.started", port })));

async function shutdown() {
  server.close(async () => { await pool.end(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
