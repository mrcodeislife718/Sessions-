import Link from "next/link";
import { SessionsBrand } from "../components/SessionsBrand";

const values = [
  {
    title: "Familiar where familiarity helps",
    body: "Repositories, staged changes, diffs, history, reviews, search, status, keyboard shortcuts, and clear source navigation remain immediately recognizable.",
  },
  {
    title: "Sessions-native where it matters",
    body: "Workstreams, Checkpoints, human and AI provenance, verification evidence, replay, semantic change understanding, and protected recovery make the workflow materially stronger.",
  },
  {
    title: "Complex underneath. Calm on top.",
    body: "Content addressing, immutable history, execution lineage, isolation, integrity checks, and distributed synchronization stay behind an interface built around obvious developer intentions.",
  },
  {
    title: "Progress you can actually see",
    body: "Work, verification, reviews, integrations, releases, deployments, and recovery remain connected so the repository tells an engineering story instead of showing disconnected artifacts.",
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
          <Link href="/dashboard">Workspace</Link>
          <Link href="/dashboard" className="button sessions-primary">Start building</Link>
        </div>
      </nav>

      <section className="sessions-hero" id="product">
        <div className="sessions-hero-copy">
          <div className="sessions-kicker">Native development infrastructure for humans and AI</div>
          <h1>Software changes.<br /><span>Know exactly why.</span></h1>
          <p>
            Build, understand, verify, review, publish, deploy, and recover software across humans,
            AI systems, and AI agents — without turning the developer workflow into another black box.
          </p>
          <div className="sessions-hero-actions">
            <Link href="/dashboard" className="button button-large sessions-primary">Start building</Link>
            <a href="#approach" className="button button-large sessions-secondary">See how Sessions works</a>
          </div>
          <div className="sessions-trust-line">
            <span>Local-first</span>
            <span>Immutable Checkpoints</span>
            <span>Protected recovery</span>
          </div>
        </div>

        <div className="product-window" aria-label="Sessions repository workspace preview">
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
              <span>Workstreams</span>
              <span>Checkpoints</span>
              <span>Sessions</span>
              <span>Reviews</span>
              <span>Verify</span>
              <span>Ship</span>
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
              <div className="progress-step done">Implement</div>
              <div className="progress-step current">Verify</div>
              <div className="progress-step">Review</div>
              <div className="progress-step">Publish</div>
            </div>
            <div className="checkpoint-focus">
              <div>
                <div className="checkpoint-title"><span className="checkpoint-glyph">◆</span><strong>booking-recovery-v7</strong></div>
                <p>Booking retries are idempotent. Interrupted confirmations preserve appointment state. Recovery paths are attached to the verified state.</p>
              </div>
              <div className="checkpoint-evidence"><strong>18 / 18 passed</strong><span>Low risk · recovery ready</span></div>
            </div>
            <div className="activity-list" aria-label="Recent engineering activity">
              <div className="activity-row"><time>03:21</time><span className="activity-symbol">✓</span><span>Verification completed</span><small>18 checks</small></div>
              <div className="activity-row"><time>03:20</time><span className="activity-symbol">◆</span><span>Implementation Agent created Checkpoint</span><small>booking-recovery-v7</small></div>
              <div className="activity-row"><time>03:17</time><span className="activity-symbol">◇</span><span>Charles changed retry architecture</span><small>Human</small></div>
              <div className="activity-row"><time>03:14</time><span className="activity-symbol">!</span><span>Integration test exposed duplicate callback</span><small>Recovered</small></div>
            </div>
          </div>
        </div>
      </section>

      <section className="sessions-value" id="approach">
        <div className="sessions-section-label">The Sessions approach</div>
        <h2>Keep the developer muscle memory. Remove the unnecessary friction. Add the context software development now needs.</h2>
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
          <h2>Use the workflow you already understand. Gain the evidence, intelligence, and recovery you wish had always been there.</h2>
          <p>Sessions keeps source control, collaboration, execution history, verification, and recovery connected without making the frontend feel as complicated as the infrastructure underneath it.</p>
        </div>
        <Link href="/dashboard" className="button button-large sessions-primary">Open Sessions</Link>
      </section>
    </main>
  );
}
