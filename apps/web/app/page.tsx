import Link from "next/link";

const outcomes = [
  {
    title: "Know what changed",
    body: "See the human, AI system, or AI agent behind every consequential change — with the objective, tools, commands, files, and resulting state attached.",
  },
  {
    title: "Know if it is safe",
    body: "Keep verification evidence beside the work: lint, types, tests, builds, security checks, policy gates, and review requirements.",
  },
  {
    title: "Recover without archaeology",
    body: "Move from failure to a known checkpoint using recorded snapshots, replay plans, rollback targets, and the timeline that explains how you got there.",
  },
];

const flow = [
  "Start a Session",
  "Build with humans + AI",
  "Capture execution",
  "Verify the result",
  "Replay what happened",
  "Rollback when needed",
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
          <Link href="/dashboard" className="button button-secondary">Open demo</Link>
          <Link href="/dashboard" className="button button-primary">Start a Session</Link>
        </div>
      </nav>

      <section className="hero section-wrap">
        <div className="eyebrow">Built for AI systems, AI agents, and humans</div>
        <h1>Stop guessing what changed.<br />Know. Verify. Recover.</h1>
        <p className="hero-copy">
          Sessions keeps the execution story around your software — who or what changed it,
          why it changed, what was verified, and how to replay or roll it back when something breaks.
        </p>
        <div className="hero-actions">
          <Link href="/dashboard" className="button button-primary button-large">Explore Sessions</Link>
          <a href="#how-it-works" className="button button-ghost button-large">See the workflow</a>
        </div>
        <div className="hero-proof">
          <span>No workflow replacement required.</span>
          <span>Works alongside Git + GitHub.</span>
          <span>Local-first path available.</span>
        </div>
      </section>

      <section className="section-wrap problem-grid">
        <article className="problem-copy">
          <div className="eyebrow">The developer problem</div>
          <h2>AI can change more code than you can reasonably inspect by hand.</h2>
          <p>
            Git can show you the diff. Sessions preserves the execution around the diff: objective,
            participants, tools, commands, checkpoints, verification evidence, and recovery state.
          </p>
        </article>
        <div className="terminal-card" aria-label="Sessions execution example">
          <div className="terminal-head"><span></span><span></span><span></span><b>auth-recovery.session</b></div>
          <div className="terminal-body">
            <p><span className="muted">10:41:08</span> Human started <strong>Fix auth regression</strong></p>
            <p><span className="muted">10:41:19</span> AI system created execution plan</p>
            <p><span className="muted">10:42:03</span> Agent modified <code>auth/session.ts</code></p>
            <p><span className="muted">10:42:34</span> Verification <span className="bad">failed 2 tests</span></p>
            <p><span className="muted">10:42:36</span> Stable checkpoint identified</p>
            <p><span className="muted">10:42:41</span> <span className="good">Rollback safe</span> · confidence 96%</p>
          </div>
        </div>
      </section>

      <section className="section-wrap" id="how-it-works">
        <div className="section-heading">
          <div className="eyebrow">Make the hard parts easier</div>
          <h2>Less debugging archaeology. Less blind trust. Faster recovery.</h2>
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
          <h2>Your work stays understandable from goal to recovery.</h2>
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
          <h2>Build faster without giving up the ability to understand what happened.</h2>
        </div>
        <Link href="/dashboard" className="button button-primary button-large">Open the working surface</Link>
      </section>
    </main>
  );
}
