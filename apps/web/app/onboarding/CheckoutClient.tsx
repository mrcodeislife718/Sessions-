"use client";

import { FormEvent, useEffect, useState } from "react";

const allowedPlans = new Set(["developer", "team", "business", "enterprise"]);

type AuthResponse = { token?: string; error?: string };

export function CheckoutClient() {
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [plan, setPlan] = useState("developer");
  const [displayName, setDisplayName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const queryPlan = new URLSearchParams(window.location.search).get("plan") ?? "developer";
    if (allowedPlans.has(queryPlan)) setPlan(queryPlan);
    const stored = window.localStorage.getItem("sessions_api_token");
    if (stored) void routeExistingCustomer(stored, queryPlan);
  }, []);

  async function subscription(token: string) {
    const base = process.env.NEXT_PUBLIC_SESSIONS_BILLING_URL || window.location.origin;
    const response = await fetch(`${base}/api/billing/subscription`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!response.ok) return null;
    return response.json().catch(() => null);
  }

  async function routeExistingCustomer(token: string, selectedPlan = plan) {
    const current = await subscription(token);
    if (current?.entitlement_status === "active") {
      window.location.assign("/dashboard");
      return;
    }
    await openCheckout(token, allowedPlans.has(selectedPlan) ? selectedPlan : plan);
  }

  async function openCheckout(token: string, selectedPlan: string) {
    setStatus("Creating secure Stripe Checkout…");
    const base = process.env.NEXT_PUBLIC_SESSIONS_BILLING_URL || window.location.origin;
    const response = await fetch(`${base}/api/billing/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ planKey: selectedPlan }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? `Checkout failed with HTTP ${response.status}`);
    if (!body.url) throw new Error("Stripe Checkout URL was not returned.");
    window.location.assign(body.url);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatus(mode === "signup" ? "Creating your Sessions workspace…" : "Signing in…");
    try {
      const base = window.location.origin;
      const payload = mode === "signup"
        ? { displayName, workspaceName, email, password, planKey: plan }
        : { email, password };
      const response = await fetch(`${base}/api/auth/${mode === "signup" ? "signup" : "login"}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({})) as AuthResponse;
      if (!response.ok || !body.token) throw new Error(body.error ?? `Authentication failed with HTTP ${response.status}`);
      window.localStorage.setItem("sessions_api_token", body.token);
      if (mode === "login") {
        const current = await subscription(body.token);
        if (current?.entitlement_status === "active") {
          window.location.assign("/dashboard");
          return;
        }
      }
      await openCheckout(body.token, plan);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Sessions onboarding could not be completed.");
      setBusy(false);
    }
  }

  return (
    <div className="checkout-panel">
      <div className="checkout-step"><span>1</span><div><strong>{mode === "signup" ? "Create your Sessions account" : "Sign in to Sessions"}</strong><p>{mode === "signup" ? "Your organization, workspace, owner identity and secure workspace credential are created automatically." : "Use your Sessions account to continue into an active workspace or finish payment."}</p></div></div>
      <div className="segmented" aria-label="Authentication mode">
        <button className={mode === "signup" ? "selected" : ""} type="button" onClick={() => setMode("signup")}>Create account</button>
        <button className={mode === "login" ? "selected" : ""} type="button" onClick={() => setMode("login")}>Sign in</button>
      </div>
      <form onSubmit={submit}>
        {mode === "signup" ? <>
          <label htmlFor="sessions-name">Your name</label>
          <input id="sessions-name" required minLength={2} maxLength={120} autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Developer name" />
          <label htmlFor="sessions-workspace">Workspace name</label>
          <input id="sessions-workspace" required minLength={2} maxLength={120} value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="Acme Engineering" />
        </> : null}
        <label htmlFor="sessions-email">Email</label>
        <input id="sessions-email" required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" />
        <label htmlFor="sessions-password">Password</label>
        <input id="sessions-password" required type="password" minLength={12} maxLength={256} autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="12+ characters" />
        <label htmlFor="sessions-plan">Paid plan</label>
        <select id="sessions-plan" value={plan} onChange={(event) => setPlan(event.target.value)}>
          <option value="developer">Developer — $49/month</option>
          <option value="team">Team — $299/month</option>
          <option value="business">Business — $999/month</option>
          <option value="enterprise">Enterprise — custom</option>
        </select>
        <button className="button button-large sessions-primary button-full" disabled={busy} type="submit">{busy ? "Working…" : mode === "signup" ? "Create workspace and continue" : "Sign in and continue"}</button>
      </form>
      <button className="text-button checkout-existing" type="button" onClick={() => setMode(mode === "signup" ? "login" : "signup")}>{mode === "signup" ? "Already have an account? Sign in" : "Need an account? Create one"}</button>
      {status ? <p className="checkout-status" role="status">{status}</p> : null}
    </div>
  );
}
