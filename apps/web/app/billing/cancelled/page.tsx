import Link from "next/link";
import { SessionsBrand } from "../../../components/SessionsBrand";

export default function BillingCancelledPage() {
  return (
    <main className="commerce-shell">
      <nav className="topbar sessions-marketing-nav">
        <Link href="/" aria-label="Sessions home"><SessionsBrand /></Link>
        <div className="sessions-nav-links"><Link href="/pricing">Pricing</Link><Link href="/dashboard">Repositories</Link></div>
      </nav>
      <section className="billing-result-shell">
        <div className="sessions-section-label">Checkout cancelled</div>
        <h1>No payment was completed.</h1>
        <p>Your Sessions workspace remains unchanged. You can return to pricing, choose another plan, or continue into an already-active workspace.</p>
        <div className="billing-result-actions">
          <Link className="button sessions-primary" href="/pricing">Return to pricing</Link>
          <Link className="button sessions-secondary" href="/onboarding">Reconnect workspace</Link>
        </div>
      </section>
    </main>
  );
}
