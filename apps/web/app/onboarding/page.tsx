import Link from "next/link";
import { SessionsBrand } from "../../components/SessionsBrand";
import { CheckoutClient } from "./CheckoutClient";

export default function OnboardingPage() {
  return (
    <main className="commerce-shell">
      <nav className="topbar sessions-marketing-nav">
        <Link href="/" aria-label="Sessions home"><SessionsBrand /></Link>
        <div className="sessions-nav-links">
          <Link href="/pricing">Pricing</Link>
          <Link href="/dashboard">Repositories</Link>
        </div>
      </nav>

      <section className="onboarding-layout">
        <div className="onboarding-copy">
          <div className="sessions-section-label">Start using Sessions</div>
          <h1>Move from Git history to persistent engineering history.</h1>
          <p>Connect your Sessions workspace, choose the paid plan that fits your development workflow, complete Stripe Checkout, then import or initialize a repository.</p>
          <div className="onboarding-path">
            <div><span>01</span><strong>Connect workspace</strong><p>Authenticate with your workspace-scoped Sessions credential.</p></div>
            <div><span>02</span><strong>Activate plan</strong><p>Stripe Checkout activates the workspace entitlement after verified webhook reconciliation.</p></div>
            <div><span>03</span><strong>Bring your repository</strong><p>Import existing Git history or initialize Sessions in a repository you already use.</p></div>
            <div><span>04</span><strong>Create the first verified Session</strong><p>Capture intent, changes, execution, evidence, verification and recovery state from the first objective.</p></div>
          </div>
        </div>
        <CheckoutClient />
      </section>
    </main>
  );
}
