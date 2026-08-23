"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { SessionsBrand } from "../../components/SessionsBrand";

type Session = { id: string; repository_id: string; objective: string; status: string; created_at: string };
type Repository = { id: string; name: string; visibility: string; source_digest?: string | null; updated_at: string; created_at: string };

export function DashboardClient() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = window.localStorage.getItem("sessions_api_token");
    if (!token) { setError("Sign in to Sessions before opening repositories."); setLoading(false); return; }
    const api = process.env.NEXT_PUBLIC_SESSIONS_API_URL || window.location.origin;
    const headers = { authorization: `Bearer ${token}` };
    Promise.all([
      fetch(`${api}/api/repositories`, { headers, cache: "no-store" }).then(async (response) => { const body = await response.json().catch(() => ([])); if (!response.ok) throw new Error(body.error ?? `Repositories HTTP ${response.status}`); return body as Repository[]; }),
      fetch(`${api}/api/sessions`, { headers, cache: "no-store" }).then(async (response) => { const body = await response.json().catch(() => ([])); if (!response.ok) throw new Error(body.error ?? `Sessions HTTP ${response.status}`); return body as Session[]; }),
    ])
      .then(([repoBody, sessionBody]) => { setRepositories(Array.isArray(repoBody) ? repoBody : []); setSessions(Array.isArray(sessionBody) ? sessionBody : []); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load workspace."))
      .finally(() => setLoading(false));
  }, []);

  const active = sessions.filter((session) => session.status === "active");
  const activityByRepository = useMemo(() => {
    const map = new Map<string, Session[]>();
    for (const session of sessions) map.set(session.repository_id, [...(map.get(session.repository_id) ?? []), session]);
    return map;
  }, [sessions]);

  function signOut() { window.localStorage.removeItem("sessions_api_token"); window.location.assign("/onboarding"); }

  return (
    <main className="sessions-app">
      <aside className="sessions-sidebar">
        <Link href="/" className="sessions-sidebar-brand" aria-label="Sessions home"><SessionsBrand compact /></Link>
        <div className="sessions-workspace-picker"><i>WS</i><div><strong>Sessions Workspace</strong><span>Authenticated workspace</span></div></div>
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
          <header className="sessions-page-head"><div><h1>Home</h1><p>Your Sessions-native repositories and recent engineering activity.</p></div><div className="sessions-head-actions"><Link href="/install" className="button sessions-secondary">Install CLI</Link><Link href="/install" className="button sessions-primary">New repository</Link></div></header>
          {loading ? <div className="sessions-empty"><strong>Loading workspace…</strong>Retrieving your Sessions repositories and activity.</div> : null}
          {error ? <div className="sessions-empty"><strong>Workspace connection required.</strong>{error} <Link href="/onboarding">Sign in →</Link></div> : null}
          {!loading && !error ? <div className="sessions-overview-grid">
            <section className="sessions-section" id="repositories">
              <div className="sessions-section-title"><h2>Repositories</h2><span>{repositories.length} hosted</span></div>
              {repositories.length === 0 ? <div className="sessions-empty"><strong>No Sessions repositories yet.</strong>Install Sessions, run <code>sessions init</code>, then <code>sessions push origin</code>. The hosted repository is created automatically.</div> : <div className="repo-list">{repositories.map((repository) => { const activity = activityByRepository.get(repository.id) ?? []; const latest = activity[0]; return <Link href={`/repositories/${encodeURIComponent(repository.id)}`} className="repo-item" key={repository.id}><span className="repo-icon">{`{}`}</span><span className="repo-name"><strong>{repository.name}</strong><span>{repository.visibility} · {activity.length} Session{activity.length === 1 ? "" : "s"}</span></span><span className="repo-state">{latest ? <>Latest: <strong>{latest.objective}</strong></> : <>Ready for first Session</>}</span><span className="repo-open">{repository.source_digest ? "Open →" : "Created →"}</span></Link>; })}</div>}
              <div className="sessions-section-title" id="sessions"><h2>Recent activity</h2><span>Persistent engineering history</span></div>
              <div className="session-feed">{sessions.length === 0 ? <div className="sessions-empty"><strong>No Sessions recorded yet.</strong>Run <code>sessions start "your objective"</code> inside a pushed Sessions repository.</div> : sessions.slice(0, 10).map((session) => <Link href={`/sessions/${session.id}`} className="feed-row" key={session.id}><span className="feed-symbol">{session.status === "active" ? "●" : "◆"}</span><span className="feed-copy"><strong>{session.objective}</strong><span>{session.repository_id} · {session.status}</span></span><time>{new Date(session.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></Link>)}</div>
            </section>
            <aside className="sessions-section"><div className="sessions-section-title"><h2>Account</h2><span>Live</span></div><div className="sessions-side-panel"><div className="signal-row"><span>Active Sessions</span><strong>{active.length}</strong></div><div className="signal-row"><span>Repositories</span><strong>{repositories.length}</strong></div><div className="signal-row"><span>Source control</span><strong className="signal-good">Sessions-native</strong></div><div className="signal-row"><span>Recovery</span><strong className="signal-good">Persistent</strong></div></div><div className="sessions-section-title" id="verification"><h2>Sessions advantage</h2><span>Built in</span></div><div className="sessions-side-panel"><div className="signal-row"><span>Repository history</span><strong>Commits + intent</strong></div><div className="signal-row"><span>Human + AI authorship</span><strong>Provenance</strong></div><div className="signal-row"><span>Proof it works</span><strong>Verification</strong></div><div className="signal-row"><span>Resume interrupted work</span><strong>Recovery</strong></div></div></aside>
          </div> : null}
        </div>
      </section>
    </main>
  );
}
