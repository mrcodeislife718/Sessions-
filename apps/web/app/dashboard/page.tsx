import Link from "next/link";

export const dynamic = "force-dynamic";

type Session = {
  id: string;
  repository_id: string;
  objective: string;
  status: string;
  created_at: string;
};

async function getSessions(): Promise<Session[]> {
  const api = process.env.SESSIONS_API_URL ?? "http://localhost:4000";
  try {
    const response = await fetch(`${api}/api/sessions`, { cache: "no-store" });
    if (!response.ok) return [];
    return response.json();
  } catch {
    return [];
  }
}

export default async function DashboardPage() {
  const sessions = await getSessions();
  const active = sessions.filter((session) => session.status === "active").length;
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand sidebar-brand"><span className="brand-mark">S</span><span>Sessions</span></Link>
        <div className="workspace-switcher"><div className="workspace-avatar">WS</div><div><strong>Developer Workspace</strong><span>Live control plane</span></div></div>
        <nav className="side-nav" aria-label="Workspace navigation">
          <a className="active" href="#sessions">Sessions <span>{sessions.length}</span></a>
          <a href="#repositories">Repositories</a><a href="#verification">Verification</a><a href="#memory">Memory</a><a href="#deployments">Deployments</a>
        </nav>
        <div className="sidebar-footer"><div className="health-dot"><span></span> Control plane connected</div><small>API-backed workspace</small></div>
      </aside>

      <section className="workspace-main">
        <header className="workspace-header"><div><div className="breadcrumb">Workspace / Sessions</div><h1>Know what changed. Verify it. Recover fast.</h1><p>Human, AI-system, and AI-agent execution in one attributable history.</p></div><Link href="/" className="button button-primary">Start from CLI</Link></header>

        <section className="metric-grid" aria-label="Session health metrics">
          <article className="metric-card"><span>Active sessions</span><strong>{active}</strong><small>Currently open workflows</small></article>
          <article className="metric-card"><span>Total sessions</span><strong>{sessions.length}</strong><small>Persisted in Sessions</small></article>
          <article className="metric-card"><span>Control plane</span><strong>Live</strong><small>Postgres-backed API</small></article>
          <article className="metric-card"><span>Recovery model</span><strong>Ready</strong><small>Snapshots + rollback requests</small></article>
        </section>

        <section className="workspace-panel" id="sessions">
          <div className="panel-head"><div><h2>Recent Sessions</h2><p>Real work captured by the Sessions API.</p></div></div>
          <div className="session-list">
            {sessions.length === 0 ? (
              <div className="semantic-summary"><h3>No Sessions yet</h3><p>Run <code>sessions init</code> and <code>sessions start &lt;objective&gt;</code> after starting the Docker stack.</p></div>
            ) : sessions.map((session) => (
              <Link href={`/sessions/${session.id}`} className="session-row" key={session.id}>
                <div className="session-icon">↗</div>
                <div className="session-primary"><strong>{session.objective}</strong><span>{session.repository_id}</span></div>
                <div className="session-actor"><span>Provenance</span><strong>Human + AI ready</strong></div>
                <div className="session-verify"><span>Created</span><strong>{new Date(session.created_at).toLocaleString()}</strong></div>
                <div className={`status-pill ${session.status === "active" ? "status-warn" : "status-good"}`}>{session.status}</div>
                <time>{new Date(session.created_at).toLocaleTimeString()}</time>
              </Link>
            ))}
          </div>
        </section>

        <section className="quick-grid">
          <article className="workspace-panel quick-card"><div className="quick-icon">⌘</div><div><h3>Replay the path</h3><p>Read the ordered attributable events that produced a state without reconstructing them manually.</p></div></article>
          <article className="workspace-panel quick-card"><div className="quick-icon">↶</div><div><h3>Restore deliberately</h3><p>Rollback requests target immutable CodeVault snapshots and execute through the separate runner boundary.</p></div></article>
          <article className="workspace-panel quick-card"><div className="quick-icon">✓</div><div><h3>Keep evidence attached</h3><p>Verification records stay connected to the exact Session and snapshot they evaluated.</p></div></article>
        </section>
      </section>
    </main>
  );
}
