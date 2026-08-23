import Link from "next/link";
import { SessionsBrand } from "../components/SessionsBrand";

const values = [
  {
    title: "Familiar from the first click",
    body: "Repositories, branches, commits, pull requests, issues, diffs, history, releases, deployments, search, and source navigation use the names developers already know.",
  },
  {
    title: "More capable underneath",
    body: "Sessions adds human and AI provenance, verification evidence, execution history, persistent context, replay, recovery, and continuation without renaming familiar source-control concepts.",
  },
  {
    title: "Complex underneath. Calm on top.",
    body: "Content addressing, immutable history, execution lineage, isolation, integrity checks, and distributed synchronization stay behind an interface built around familiar developer intentions.",
  },
  {
    title: "Progress you can actually see",
    body: "Commits, verification, pull requests, Actions, releases, deployments, and recovery remain connected so the repository tells the complete engineering story.",
  },
];

export default function HomePage() {
  return (
    <main className="marketing-shell">
      <nav className="topbar sessions-marketing-nav">
        <Link href="/" aria-label="Sessions home"><SessionsBrand /></Link>
        <div className="sessions-nav-links">
          <a href="#product">Product</a>
          <a href="#approach">Why Sessions</a>
          <Link href="/pricing">Pricing</Link>
          <Link href="/dashboard">Repositories</Link>
          <Link href="/pricing" className="button sessions-primary">Get started</Link>
        </div>
      </nav>

      <section className="sessions-hero" id="product">
        <div className="sessions-hero-copy">
          <div className="sessions-kicker">Source control and collaboration for humans and AI</div>
          <h1>Software changes.<br /><span>Know exactly why.</span></h1>
          <p>
            Build, commit, review, verify, release, deploy, and recover software across humans,
            AI systems, and AI agents — with the repository workflow developers already understand.
          </p>
          <div className="sessions-hero-actions">
            <Link href="/pricing" className="button button-large sessions-primary">See plans and start</Link>
            <a href="#approach" className="button button-large sessions-secondary">See how Sessions works</a>
          </div>
          <div className="sessions-trust-line">
            <span>Git-familiar workflow</span>
            <span>Verified commits</span>
            <span>Protected recovery</span>
          </div>
        </div>

        <div className="product-window" aria-label="Sessions repository preview">
          <div className="product-titlebar">
            <div className="window-dots"><i></i><i></i><i></i></div>
            <small>Sessions · JobFlow</small>
            <small>⌘ K</small>
          </div>
          <div className="product-repo-head">
            <div className="repo-heading-row">
              <div><strong>JobFlow</strong> <span>/ booking-recovery</span></div>
              <span>◆ booking-recovery-v7 · Verified</span>
            </div>
            <div className="repo-tabs">
              <span className="active">Code</span>
              <span>Issues</span>
              <span>Pull requests</span>
              <span>Actions</span>
              <span>Projects</span>
              <span>Security</span>
              <span>Insights</span>
              <span>Settings</span>
            </div>
          </div>
          <div className="product-work">
            <div className="work-heading">
              <div>
                <h3>Prevent missed bookings during provider failures</h3>
                <p>Charles · Planner System · Implementation Agent</p>
              </div>
              <span className="live-chip">Active</span>
            </div>
            <div className="progress-rail">
              <div className="progress-step done">Plan</div>
              <div className="progress-step done">Commit</div>
              <div className="progress-step current">Actions</div>
              <div className="progress-step">Pull request</div>
              <div className="progress-step">Merge</div>
            </div>
            <div className="checkpoint-focus">
              <div>
                <div className="checkpoint-title"><span className="checkpoint-glyph">◆</span><strong>booking-recovery-v7</strong></div>
                <p>Commit verified by Sessions: retries are idempotent, interrupted confirmations preserve appointment state, and recovery evidence is attached.</p>
              </div>
              <div className="checkpoint-evidence"><strong>18 / 18 passed</strong><span>Verified · recovery ready</span></div>
            </div>
            <div className="activity-list" aria-label="Recent repository activity">
              <div className="activity-row"><time>03:21</time><span className="activity-symbol">✓</span><span>Actions completed</span><small>18 checks</small></div>
              <div className="activity-row"><time>03:20</time><span className="activity-symbol">◆</span><span>Implementation Agent created commit</span><small>booking-recovery-v7</small></div>
              <div className="activity-row"><time>03:17</time><span className="activity-symbol">◇</span><span>Charles changed retry architecture</span><small>Human</small></div>
              <div className="activity-row"><time>03:14</time><span className="activity-symbol">!</span><span>Action exposed duplicate callback</span><small>Recovered</small></div>
            </div>
          </div>
        </div>
      </section>

      <section className="sessions-value" id="approach">
        <div className="sessions-section-label">The Sessions approach</div>
        <h2>Keep Git and GitHub muscle memory. Add the context, verification, AI provenance, and recovery modern development needs.</h2>
        <div className="value-lines">
          {values.map((item, index) => (
            <div className="value-line" key={item.title}>
              <span>0{index + 1}</span>
              <strong>{item.title}</strong>
              <p>{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="sessions-final">
        <div>
          <div className="sessions-section-label">Developer-first by design</div>
          <h2>Use the Git and GitHub workflow you already understand. Gain evidence, intelligence, provenance, and recovery underneath it.</h2>
          <p>Sessions keeps repositories, commits, branches, pull requests, Actions, releases, deployments, execution history, verification, and recovery connected without forcing developers to relearn source control.</p>
        </div>
        <Link href="/pricing" className="button button-large sessions-primary">Start with Sessions</Link>
      </section>
    </main>
  );
}
