import Link from "next/link";
import { SessionsBrand } from "../../components/SessionsBrand";
import { InstallClient } from "./InstallClient";

export default function InstallPage() {
  return (
    <main className="commerce-shell">
      <nav className="topbar sessions-marketing-nav">
        <Link href="/" aria-label="Sessions home"><SessionsBrand /></Link>
        <div className="sessions-nav-links"><Link href="/pricing">Pricing</Link><Link href="/dashboard">Repositories</Link></div>
      </nav>
      <section className="onboarding-layout">
        <div className="onboarding-copy">
          <div className="sessions-section-label">Sessions-native source control</div>
          <h1>Install Sessions. Keep the familiar workflow. Replace the substrate.</h1>
          <p>Sessions does not use Git for normal repository operation. Your source objects, branches, commits, refs, remotes, verification, recovery and continuation records are stored and transferred by Sessions.</p>
          <div className="onboarding-path">
            <div><span>01</span><strong>Install</strong><p>Use the client distributed directly by your Sessions host.</p></div>
            <div><span>02</span><strong>Login</strong><p>Authenticate with the same account you purchased on the web.</p></div>
            <div><span>03</span><strong>Create repository</strong><p>Initialize a first-party Sessions repository or perform a one-time legacy import.</p></div>
            <div><span>04</span><strong>Push to Sessions</strong><p>Your hosted repository is created automatically on first native push.</p></div>
          </div>
        </div>
        <InstallClient />
      </section>
    </main>
  );
}
