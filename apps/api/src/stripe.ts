import { createHmac, timingSafeEqual } from "node:crypto";

export type StripeEvent = { id: string; type: string; created?: number; livemode?: boolean; data: { object: any } };

export function verifyStripeSignature(payload: Buffer, header: string, secret: string, toleranceSeconds = 300, nowSeconds = Math.floor(Date.now() / 1000)): StripeEvent {
  const parts = header.split(",").map((part) => part.trim());
  const timestamp = Number(parts.find((part) => part.startsWith("t="))?.slice(2));
  const signatures = parts.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
  if (!Number.isFinite(timestamp) || !signatures.length) throw new Error("invalid Stripe-Signature header");
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) throw new Error("stale Stripe webhook signature");
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload.toString("utf8")}`).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const valid = signatures.some((candidate) => {
    try {
      const candidateBuffer = Buffer.from(candidate, "hex");
      return candidateBuffer.length === expectedBuffer.length && timingSafeEqual(candidateBuffer, expectedBuffer);
    } catch { return false; }
  });
  if (!valid) throw new Error("Stripe webhook signature verification failed");
  return JSON.parse(payload.toString("utf8")) as StripeEvent;
}

export async function stripeRequest(secretKey: string, path: string, params: URLSearchParams, method = "POST"): Promise<any> {
  const base = (process.env.STRIPE_API_BASE ?? "https://api.stripe.com/v1").replace(/\/$/, "");
  const response = await fetch(`${base}/${path}`, {
    method,
    headers: { authorization: `Bearer ${secretKey}`, "content-type": "application/x-www-form-urlencoded" },
    body: method === "GET" ? undefined : params.toString(),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message ?? `Stripe API request failed (${response.status})`);
  return body;
}

export function checkoutParams(input: { priceId: string; workspaceId: string; planKey: string; successUrl: string; cancelUrl: string; customerId?: string | null }): URLSearchParams {
  const params = new URLSearchParams();
  params.set("mode", "subscription");
  params.set("success_url", input.successUrl);
  params.set("cancel_url", input.cancelUrl);
  params.set("client_reference_id", input.workspaceId);
  params.set("line_items[0][price]", input.priceId);
  params.set("line_items[0][quantity]", "1");
  params.set("metadata[workspace_id]", input.workspaceId);
  params.set("metadata[plan_key]", input.planKey);
  params.set("subscription_data[metadata][workspace_id]", input.workspaceId);
  params.set("subscription_data[metadata][plan_key]", input.planKey);
  if (input.customerId) params.set("customer", input.customerId);
  return params;
}
