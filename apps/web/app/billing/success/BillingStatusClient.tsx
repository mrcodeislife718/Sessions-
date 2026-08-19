"use client";

import { useEffect, useState } from "react";

export function BillingStatusClient() {
  const [state, setState] = useState<"checking" | "active" | "pending" | "error">("checking");
  const [message, setMessage] = useState("Confirming your paid Sessions entitlement…");

  useEffect(() => {
    let cancelled = false;
    async function check() {
      const token = window.localStorage.getItem("sessions_api_token");
      if (!token) {
        setState("error");
        setMessage("Checkout returned successfully, but this browser does not have your Sessions account credential. Sign in again from onboarding.");
        return;
      }
      const base = process.env.NEXT_PUBLIC_SESSIONS_BILLING_URL || window.location.origin;
      for (let attempt = 0; attempt < 8 && !cancelled; attempt += 1) {
        try {
          const response = await fetch(`${base}/api/billing/subscription`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
          const body = await response.json().catch(() => ({}));
          if (response.ok && body?.entitlement_status === "active") {
            setState("active");
            setMessage("Payment confirmed. Your Sessions workspace is active and ready for its first native repository.");
            return;
          }
          if (!response.ok && response.status !== 404) throw new Error(body.error ?? `HTTP ${response.status}`);
        } catch (error) {
          if (attempt === 7) {
            setState("error");
            setMessage(error instanceof Error ? error.message : "Could not confirm billing status.");
            return;
          }
        }
        setState("pending");
        setMessage("Payment completed. Waiting for Stripe webhook reconciliation…");
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
    void check();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className={`billing-result billing-${state}`}>
      <strong>{state === "active" ? "Workspace activated" : state === "error" ? "Action required" : "Finishing activation"}</strong>
      <p>{message}</p>
      <div className="billing-result-actions">
        <a className="button sessions-primary" href={state === "active" ? "/install" : "/onboarding"}>{state === "active" ? "Install Sessions" : "Return to setup"}</a>
        <a className="button sessions-secondary" href="/dashboard">Open web workspace</a>
      </div>
    </div>
  );
}
