import Link from "next/link";

const outcomes = [
  {
    title: "See progress clearly",
    body: "Follow Workstreams, Sessions, Checkpoints, reviews, verification, releases, and deployments as one continuous engineering story.",
  },
  {
    title: "Know what changed",
    body: "See the human, AI system, or AI agent behind every consequential change — with the objective, tools, commands, files, semantic impact, and resulting state attached.",
  },
  {
    title: "Know if it is safe",
    body: "Keep verification evidence beside the exact Checkpoint it qualifies: lint, types, tests, builds, security checks, policy gates, and approvals.",
  },
  {
    title: "Recover without archaeology",
    body: "Move from failure to a known-good Checkpoint using recorded state, replay, recovery evidence, and a timeline that explains how you got there.",
  },
];

const flow = [
  "Define the goal",
  "Create a Workstream",
  "Build with humans + AI",
  "Create a Checkpoint",
  "Verify + review",
  "Integrate + publish",
  "Release + deploy",
  "Replay or restore",
];

export default function HomePage() {
  return (
    <main className="marketing-shell">
      <nav className="topbar marketing-nav">
        <Link href="/" className="brand" aria-label="Sessions home">
          <span className="brand-mark">S</span>
          <span>Sessions</span>
        </Link>
        <div className="nav-actions">
          <a href="#how-it-works" className="nav-link">How it works</a>
          <Link href="/dashboard" className="button button-secondary">Explore platform</Link>
          <Link href="/dashboard" className="button button-primary">Start building</Link>
        </div>
      </nav>

      <section className="hero section-wrap">
        <div className="eyebrow">Source control + collaboration + intelligence for AI systems, AI agents, and humans</div>
        <h1>One place to build software.<br />Know. Verify. Recover.</h1>
        <p className="hero-copy">
          Sessions owns the development story from repository and Workstream to Checkpoint,
          review, verification, release, deployment, replay, and restore.
        </p>
        <div className="hero-actions">
          <Link href="/dashboard" className="button button-primary button-large">Explore Sessions</Link>
          <a href="#how-it-works" className="button button-ghost button-large">See the workflow</a>
        </div>
        <div className="hero-proof">
          <span>Native source control.</span>
          <span>Native collaboration.</span>
          <span>Built-in execution intelligence.</span>
        </div>
      </section>

      <section className="section-wrap problem-grid">
        <article className="problem-copy">
          <div className="eyebrow">The developer problem</div>
          <h2>Development history should explain progress — not force you to reconstruct it.</h2>
          <p>
            Sessions keeps objective, participants, source changes, Checkpoints, verification,
            reviews, releases, deployments, and recovery state connected from the beginning.
          </p>
        </article>
        <div className="terminal-card" aria-label="Sessions execution example">
          <div className="terminal-head"><span></span><span></span><span></span><b>auth-recovery.session</b></div>
          <div className="terminal-body">
            <p><span className="muted">10:41:08</span> Workstream started <strong>Fix auth regression</strong></p>
            <p><span className="muted">10:41:19</span> AI system created execution plan</p>
            <p><span className="muted">10:42:03</span> Agent modified authentication state</p>
            <p><span className="muted">10:42:20</span> Checkpoint <strong>auth-candidate-01</strong> created</p>
            <p><span className="muted">10:42:34</span> Verification <span className="bad">failed 2 tests</span></p>
            <p><span className="muted">10:42:41</span> <span className="good">Known-good restore target available</span></p>
          </div>
        </div>
      </section>

      <section className="section-wrap" id="how-it-works">
        <div className="section-heading">
          <div className="eyebrow">A simpler development model</div>
          <h2>Less bookkeeping. More visible progress. Safer software.</h2>
        </div>
        <div className="outcome-grid">
          {outcomes.map((item, index) => (
            <article className="outcome-card" key={item.title}>
              <div className="card-index">0{index + 1}</div>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section-wrap flow-section">
        <div className="section-heading">
          <div className="eyebrow">One continuous record</div>
          <h2>Your work stays understandable from goal to production and recovery.</h2>
        </div>
        <div className="flow-row">
          {flow.map((step, index) => (
            <div className="flow-step" key={step}>
              <span>{index + 1}</span>
              <strong>{step}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="section-wrap final-cta">
        <div>
          <div className="eyebrow">Developer-first infrastructure</div>
          <h2>Build, collaborate, verify, publish, deploy, and recover in one native platform.</h2>
        </div>
        <Link href="/dashboard" className="button button-primary button-large">Open Sessions</Link>
      </section>
    </main>
  );
}
