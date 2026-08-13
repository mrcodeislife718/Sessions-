import Link from "next/link";
import { SessionsBrand } from "../../components/SessionsBrand";

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
  const active = sessions.filter((session) => session.status === "active");
  const repositoryMap = new Map<string, Session[]>();
  for (const session of sessions) repositoryMap.set(session.repository_id, [...(repositoryMap.get(session.repository_id) ?? []), session]);
  const repositories = [...repositoryMap.entries()].map(([id, work]) => ({ id, sessions: work, latest: work[0] }));

  return (
    <main className="sessions-app">
      <aside className="sessions-sidebar">
        <Link href="/" className="sessions-sidebar-brand" aria-label="Sessions home"><SessionsBrand compact /></Link>
        <div className="sessions-workspace-picker"><i>WS</i><div><strong>Developer Workspace</strong><span>Personal workspace</span></div></div>

        <div className="sessions-side-section">Workspace</div>
        <nav aria-label="Workspace navigation">
          <a className="sessions-side-link active" href="#overview"><span>Overview</span></a>
          <a className="sessions-side-link" href="#repositories"><span>Repositories</span><b>{repositories.length}</b></a>
          <a className="sessions-side-link" href="#work"><span>Work</span><b>{active.length}</b></a>
          <a className="sessions-side-link" href="#reviews"><span>Reviews</span></a>
        </nav>

        <div className="sessions-side-section">Build</div>
        <nav>
          <a className="sessions-side-link" href="#checkpoints"><span>Checkpoints</span></a>
          <a className="sessions-side-link" href="#verification"><span>Verification</span></a>
          <a className="sessions-side-link" href="#ship"><span>Releases & Deployments</span></a>
        </nav>

        <div className="sessions-side-section">Intelligence</div>
        <nav>
          <a className="sessions-side-link" href="#timeline"><span>Timeline</span></a>
          <a className="sessions-side-link" href="#memory"><span>Memory</span></a>
          <a className="sessions-side-link" href="#actors"><span>People & AI</span></a>
        </nav>

        <div className="sessions-sidebar-bottom"><div className="sessions-health">Control plane connected</div></div>
      </aside>

      <section className="sessions-main">
        <header className="sessions-commandbar">
          <div className="sessions-commandbar-path">Workspace / Overview</div>
          <div className="sessions-search">⌕ <span>Search repositories, Checkpoints, Sessions, people…</span><kbd>⌘ K</kbd></div>
          <div className="sessions-command-actions"><button className="sessions-icon-button" aria-label="Notifications">○</button><button className="sessions-icon-button">CC</button></div>
        </header>

        <div className="sessions-content" id="overview">
          <header className="sessions-page-head">
            <div><h1>Your work</h1><p>Repositories, active work, and engineering progress in one place.</p></div>
            <div className="sessions-head-actions"><Link href="/" className="button sessions-secondary">Documentation</Link><button className="button sessions-primary">New repository</button></div>
          </header>

          <div className="sessions-overview-grid">
            <section className="sessions-section" id="repositories">
              <div className="sessions-section-title"><h2>Repositories</h2><span>{repositories.length} available</span></div>
              {repositories.length === 0 ? (
                <div className="sessions-empty"><strong>No repositories are active yet.</strong>Initialize a project with <code>sessions init</code>, then start work. Sessions will keep the repository, Workstream, Checkpoints, and execution history connected.</div>
              ) : (
                <div className="repo-list">
                  {repositories.map((repository) => (
                    <Link href={`/sessions/${repository.latest.id}`} className="repo-item" key={repository.id}>
                      <span className="repo-icon">{`{}`}</span>
                      <span className="repo-name"><strong>{repository.id}</strong><span>{repository.sessions.length} recorded Session{repository.sessions.length === 1 ? "" : "s"}</span></span>
                      <span className="repo-state">Latest work: <strong>{repository.latest.objective}</strong></span>
                      <span className="repo-open">Open →</span>
                    </Link>
                  ))}
                </div>
              )}

              <div className="sessions-section-title" id="work"><h2>Recent work</h2><span>Execution history</span></div>
              <div className="session-feed">
                {sessions.length === 0 ? (
                  <div className="sessions-empty"><strong>No work recorded yet.</strong>Run <code>sessions start "your objective"</code> inside a Sessions repository.</div>
                ) : sessions.slice(0, 10).map((session) => (
                  <Link href={`/sessions/${session.id}`} className="feed-row" key={session.id}>
                    <span className="feed-symbol">{session.status === "active" ? "●" : "◆"}</span>
                    <span className="feed-copy"><strong>{session.objective}</strong><span>{session.repository_id} · {session.status}</span></span>
                    <time>{new Date(session.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
                  </Link>
                ))}
              </div>
            </section>

            <aside className="sessions-section">
              <div className="sessions-section-title"><h2>Workspace state</h2><span>Live</span></div>
              <div className="sessions-side-panel">
                <div className="signal-row"><span>Active Sessions</span><strong className={active.length ? "signal-neutral" : ""}>{active.length}</strong></div>
                <div className="signal-row"><span>Repositories</span><strong>{repositories.length}</strong></div>
                <div className="signal-row"><span>Control plane</span><strong className="signal-good">Connected</strong></div>
                <div className="signal-row"><span>Checkpoint recovery</span><strong className="signal-good">Available when recorded</strong></div>
              </div>

              <div className="sessions-section-title" id="verification"><h2>What Sessions keeps connected</h2><span>Native model</span></div>
              <div className="sessions-side-panel">
                <div className="signal-row"><span>Source state</span><strong>Repository + Checkpoint</strong></div>
                <div className="signal-row"><span>Parallel work</span><strong>Workstreams</strong></div>
                <div className="signal-row"><span>Who or what acted</span><strong>Provenance</strong></div>
                <div className="signal-row"><span>Why state is trusted</span><strong>Verification</strong></div>
                <div className="signal-row"><span>How to get back</span><strong>Recovery</strong></div>
              </div>
            </aside>
          </div>
        </div>
      </section>
    </main>
  );
}
