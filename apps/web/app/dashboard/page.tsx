import Link from "next/link";

const sessions = [
  {
    id: "auth-regression",
    title: "Fix auth regression",
    repo: "acme/web",
    branch: "fix/session-refresh",
    actor: "Human + AI system + 2 agents",
    status: "Needs review",
    verification: "7/9 checks passed",
    time: "4 min ago",
  },
  {
    id: "billing-webhook",
    title: "Harden billing webhook retries",
    repo: "acme/api",
    branch: "feat/webhook-idempotency",
    actor: "Human + AI agent",
    status: "Verified",
    verification: "12/12 checks passed",
    time: "41 min ago",
  },
  {
    id: "search-index",
    title: "Reduce search indexing latency",
    repo: "acme/platform",
    branch: "perf/index-batching",
    actor: "AI system",
    status: "Verified",
    verification: "8/8 checks passed",
    time: "2 hr ago",
  },
];

export default function DashboardPage() {
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand sidebar-brand"><span className="brand-mark">S</span><span>Sessions</span></Link>
        <div className="workspace-switcher">
          <div className="workspace-avatar">AC</div>
          <div><strong>Acme Engineering</strong><span>3 repositories</span></div>
        </div>
        <nav className="side-nav" aria-label="Workspace navigation">
          <a className="active" href="#sessions">Sessions <span>12</span></a>
          <a href="#repositories">Repositories <span>3</span></a>
          <a href="#verification">Verification</a>
          <a href="#memory">Memory</a>
          <a href="#deployments">Deployments</a>
        </nav>
        <div className="sidebar-footer">
          <div className="health-dot"><span></span> All systems healthy</div>
          <small>Local capture connected</small>
        </div>
      </aside>

      <section className="workspace-main">
        <header className="workspace-header">
          <div>
            <div className="breadcrumb">Workspace / Sessions</div>
            <h1>Good evening, Charles.</h1>
            <p>Everything your team and AI changed, verified, and can recover — in one place.</p>
          </div>
          <button className="button button-primary">+ Start Session</button>
        </header>

        <section className="metric-grid" aria-label="Session health metrics">
          <article className="metric-card"><span>Active sessions</span><strong>3</strong><small>2 include AI execution</small></article>
          <article className="metric-card"><span>Verification pass rate</span><strong>94%</strong><small>+4% from last week</small></article>
          <article className="metric-card"><span>Rollback ready</span><strong>11/12</strong><small>1 session needs a checkpoint</small></article>
          <article className="metric-card"><span>Time saved</span><strong>6.8h</strong><small>Estimated from replay + recovery</small></article>
        </section>

        <section className="workspace-panel" id="sessions">
          <div className="panel-head">
            <div><h2>Recent Sessions</h2><p>Follow work from objective to verification and recovery.</p></div>
            <div className="segmented"><button className="selected">All</button><button>Needs review</button><button>Verified</button></div>
          </div>
          <div className="session-list">
            {sessions.map((session) => (
              <Link href={`/sessions/${session.id}`} className="session-row" key={session.id}>
                <div className="session-icon">↗</div>
                <div className="session-primary"><strong>{session.title}</strong><span>{session.repo} · {session.branch}</span></div>
                <div className="session-actor"><span>Participants</span><strong>{session.actor}</strong></div>
                <div className="session-verify"><span>Verification</span><strong>{session.verification}</strong></div>
                <div className={`status-pill ${session.status === "Verified" ? "status-good" : "status-warn"}`}>{session.status}</div>
                <time>{session.time}</time>
              </Link>
            ))}
          </div>
        </section>

        <section className="quick-grid">
          <article className="workspace-panel quick-card"><div className="quick-icon">⌘</div><div><h3>Replay a failure</h3><p>Jump to the events that produced a broken state instead of reconstructing it from chat and terminal history.</p></div><button className="text-button">Find failure →</button></article>
          <article className="workspace-panel quick-card"><div className="quick-icon">↶</div><div><h3>Restore a checkpoint</h3><p>See known-good states and their verification evidence before you roll anything back.</p></div><button className="text-button">View checkpoints →</button></article>
          <article className="workspace-panel quick-card"><div className="quick-icon">✓</div><div><h3>Review AI changes</h3><p>Focus attention on risky or unverified changes instead of reading every generated line equally.</p></div><button className="text-button">Open review queue →</button></article>
        </section>
      </section>
    </main>
  );
}
