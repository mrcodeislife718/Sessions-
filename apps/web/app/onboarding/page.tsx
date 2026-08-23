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
          <h1>Create your workspace. Pay. Import. Start building.</h1>
          <p>Sessions provisions the account, organization, workspace and owner credential automatically. Choose a paid plan, complete Stripe Checkout, then bring over the repository you already use.</p>
          <div className="onboarding-path">
            <div><span>01</span><strong>Create account</strong><p>Sign up with your email and password. Sessions creates the workspace and secure credential automatically.</p></div>
            <div><span>02</span><strong>Activate plan</strong><p>Stripe Checkout activates the workspace only after verified webhook reconciliation.</p></div>
            <div><span>03</span><strong>Bring your repository</strong><p>Import existing Git history or initialize Sessions in a repository you already use.</p></div>
            <div><span>04</span><strong>Create the first verified Session</strong><p>Capture intent, changes, execution, evidence, verification and recovery state from the first objective.</p></div>
          </div>
        </div>
        <CheckoutClient />
      </section>
    </main>
  );
}
