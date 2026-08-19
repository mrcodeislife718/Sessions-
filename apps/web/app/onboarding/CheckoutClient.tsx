"use client";

import { FormEvent, useEffect, useState } from "react";

const allowedPlans = new Set(["developer", "team", "business", "enterprise"]);

export function CheckoutClient() {
  const [token, setToken] = useState("");
  const [plan, setPlan] = useState("developer");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const queryPlan = new URLSearchParams(window.location.search).get("plan") ?? "developer";
    if (allowedPlans.has(queryPlan)) setPlan(queryPlan);
    const stored = window.localStorage.getItem("sessions_api_token");
    if (stored) setToken(stored);
  }, []);

  async function beginCheckout(event: FormEvent) {
    event.preventDefault();
    if (!token.trim()) {
      setStatus("A Sessions workspace token is required before checkout.");
      return;
    }
    setBusy(true);
    setStatus("Creating secure Stripe Checkout…");
    try {
      const billingUrl = process.env.NEXT_PUBLIC_SESSIONS_BILLING_URL ?? "http://localhost:4100";
      const response = await fetch(`${billingUrl}/api/billing/checkout`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token.trim()}` },
        body: JSON.stringify({ planKey: plan }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? `Checkout failed with HTTP ${response.status}`);
      if (!body.url) throw new Error("Stripe Checkout URL was not returned.");
      window.localStorage.setItem("sessions_api_token", token.trim());
      window.location.assign(body.url);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Checkout could not be started.");
      setBusy(false);
    }
  }

  function continueWithoutCheckout() {
    if (!token.trim()) {
      setStatus("Enter your Sessions workspace token first.");
      return;
    }
    window.localStorage.setItem("sessions_api_token", token.trim());
    window.location.assign("/dashboard");
  }

  return (
    <div className="checkout-panel">
      <div className="checkout-step"><span>1</span><div><strong>Connect your workspace</strong><p>Use the workspace token issued during Sessions workspace provisioning. The token is stored only in this browser.</p></div></div>
      <form onSubmit={beginCheckout}>
        <label htmlFor="sessions-token">Sessions workspace token</label>
        <input id="sessions-token" type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} placeholder="sess_…" />
        <label htmlFor="sessions-plan">Paid plan</label>
        <select id="sessions-plan" value={plan} onChange={(event) => setPlan(event.target.value)}>
          <option value="developer">Developer — $49/month</option>
          <option value="team">Team — $299/month</option>
          <option value="business">Business — $999/month</option>
          <option value="enterprise">Enterprise — custom</option>
        </select>
        <button className="button button-large sessions-primary button-full" disabled={busy} type="submit">{busy ? "Opening Stripe…" : "Continue to secure checkout"}</button>
      </form>
      <button className="text-button checkout-existing" type="button" onClick={continueWithoutCheckout}>Already subscribed? Open your workspace</button>
      {status ? <p className="checkout-status" role="status">{status}</p> : null}
    </div>
  );
}
