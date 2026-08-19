"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { SessionsBrand } from "../../components/SessionsBrand";

type Session = { id: string; repository_id: string; objective: string; status: string; created_at: string };

export function DashboardClient() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = window.localStorage.getItem("sessions_api_token");
    if (!token) {
      setError("Connect your Sessions workspace before opening repositories.");
      setLoading(false);
      return;
    }
    const api = process.env.NEXT_PUBLIC_SESSIONS_API_URL || window.location.origin;
    fetch(`${api}/api/sessions`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ([]));
        if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
        return body as Session[];
      })
      .then((body) => setSessions(Array.isArray(body) ? body : []))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load workspace."))
      .finally(() => setLoading(false));
  }, []);

  const active = sessions.filter((session) => session.status === "active");
  const repositories = useMemo(() => {
    const repositoryMap = new Map<string, Session[]>();
    for (const session of sessions) repositoryMap.set(session.repository_id, [...(repositoryMap.get(session.repository_id) ?? []), session]);
    return [...repositoryMap.entries()].map(([id, work]) => ({ id, sessions: work, latest: work[0] }));
  }, [sessions]);

  function signOut() {
    window.localStorage.removeItem("sessions_api_token");
    window.location.assign("/onboarding");
  }

  return (
    <main className="sessions-app">
      <aside className="sessions-sidebar">
        <Link href="/" className="sessions-sidebar-brand" aria-label="Sessions home"><SessionsBrand compact /></Link>
        <div className="sessions-workspace-picker"><i>WS</i><div><strong>Developer Workspace</strong><span>Authenticated workspace</span></div></div>
        <div className="sessions-side-section">Home</div>
        <nav aria-label="Primary navigation">
          <a className="sessions-side-link active" href="#overview"><span>Overview</span></a>
          <a className="sessions-side-link" href="#repositories"><span>Repositories</span><b>{repositories.length}</b></a>
          <a className="sessions-side-link" href="#issues"><span>Issues</span></a>
          <a className="sessions-side-link" href="#pull-requests"><span>Pull requests</span></a>
        </nav>
        <div className="sessions-side-section">Repository</div>
        <nav><a className="sessions-side-link" href="#code"><span>Code</span></a><a className="sessions-side-link" href="#actions"><span>Actions</span></a><a className="sessions-side-link" href="#projects"><span>Projects</span></a><a className="sessions-side-link" href="#security"><span>Security</span></a><a className="sessions-side-link" href="#insights"><span>Insights</span></a><a className="sessions-side-link" href="#settings"><span>Settings</span></a></nav>
        <div className="sessions-side-section">Sessions</div>
        <nav><a className="sessions-side-link" href="#sessions"><span>Sessions</span><b>{active.length}</b></a><a className="sessions-side-link" href="#verification"><span>Verification</span></a><a className="sessions-side-link" href="#recovery"><span>Recovery</span></a><a className="sessions-side-link" href="#ai-activity"><span>AI activity</span></a></nav>
        <div className="sessions-sidebar-bottom"><button className="text-button" onClick={signOut}>Sign out</button></div>
      </aside>

      <section className="sessions-main">
        <header className="sessions-commandbar"><div className="sessions-commandbar-path">Home / Overview</div><div className="sessions-search">⌕ <span>Search repositories, commits, issues, pull requests…</span><kbd>⌘ K</kbd></div><div className="sessions-command-actions"><Link className="button sessions-secondary" href="/pricing">Plan</Link></div></header>
        <div className="sessions-content" id="overview">
          <header className="sessions-page-head"><div><h1>Home</h1><p>Your repositories and recent activity.</p></div><div className="sessions-head-actions"><Link href="/onboarding" className="button sessions-secondary">Connect workspace</Link><Link href="/onboarding" className="button sessions-primary">Import repository</Link></div></header>

          {loading ? <div className="sessions-empty"><strong>Loading workspace…</strong>Authenticating and retrieving your Sessions repositories.</div> : null}
          {error ? <div className="sessions-empty"><strong>Workspace connection required.</strong>{error} <Link href="/onboarding">Connect your workspace →</Link></div> : null}

          {!loading && !error ? <div className="sessions-overview-grid">
            <section className="sessions-section" id="repositories">
              <div className="sessions-section-title"><h2>Repositories</h2><span>{repositories.length} available</span></div>
              {repositories.length === 0 ? <div className="sessions-empty"><strong>No repositories yet.</strong>Import an existing Git repository or initialize one with <code>sessions init</code>.</div> : <div className="repo-list">{repositories.map((repository) => <Link href={`/sessions/${repository.latest.id}`} className="repo-item" key={repository.id}><span className="repo-icon">{`{}`}</span><span className="repo-name"><strong>{repository.id}</strong><span>{repository.sessions.length} recorded Session{repository.sessions.length === 1 ? "" : "s"}</span></span><span className="repo-state">Latest activity: <strong>{repository.latest.objective}</strong></span><span className="repo-open">Open →</span></Link>)}</div>}
              <div className="sessions-section-title" id="sessions"><h2>Recent activity</h2><span>Repository history</span></div>
              <div className="session-feed">{sessions.length === 0 ? <div className="sessions-empty"><strong>No activity recorded yet.</strong>Run <code>sessions start "your objective"</code> inside a Sessions repository.</div> : sessions.slice(0, 10).map((session) => <Link href={`/sessions/${session.id}`} className="feed-row" key={session.id}><span className="feed-symbol">{session.status === "active" ? "●" : "◆"}</span><span className="feed-copy"><strong>{session.objective}</strong><span>{session.repository_id} · {session.status}</span></span><time>{new Date(session.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></Link>)}</div>
            </section>
            <aside className="sessions-section"><div className="sessions-section-title"><h2>Account</h2><span>Live</span></div><div className="sessions-side-panel"><div className="signal-row"><span>Active Sessions</span><strong>{active.length}</strong></div><div className="signal-row"><span>Repositories</span><strong>{repositories.length}</strong></div><div className="signal-row"><span>Service</span><strong className="signal-good">Connected</strong></div><div className="signal-row"><span>Recovery</span><strong className="signal-good">Available when recorded</strong></div></div><div className="sessions-section-title" id="verification"><h2>Sessions advantage</h2><span>Built in</span></div><div className="sessions-side-panel"><div className="signal-row"><span>Source control</span><strong>Repository + Commit</strong></div><div className="signal-row"><span>Human + AI authorship</span><strong>Provenance</strong></div><div className="signal-row"><span>Proof it works</span><strong>Verification</strong></div><div className="signal-row"><span>Resume interrupted work</span><strong>Recovery</strong></div></div></aside>
          </div> : null}
        </div>
      </section>
    </main>
  );
}
