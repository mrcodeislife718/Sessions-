import Link from "next/link";
import { SessionsBrand } from "../../../components/SessionsBrand";
import { BillingStatusClient } from "./BillingStatusClient";

export default function BillingSuccessPage() {
  return (
    <main className="commerce-shell">
      <nav className="topbar sessions-marketing-nav">
        <Link href="/" aria-label="Sessions home"><SessionsBrand /></Link>
        <div className="sessions-nav-links"><Link href="/dashboard">Repositories</Link></div>
      </nav>
      <section className="billing-result-shell">
        <div className="sessions-section-label">Stripe Checkout complete</div>
        <h1>Activating your Sessions workspace.</h1>
        <p>Sessions confirms payment asynchronously through verified Stripe webhooks before paid access is considered active.</p>
        <BillingStatusClient />
      </section>
    </main>
  );
}
