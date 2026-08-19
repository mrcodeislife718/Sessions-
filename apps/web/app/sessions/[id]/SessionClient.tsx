"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

type Aggregate = {
  session: { id: string; repository_id: string; objective: string; status: string; created_at: string };
  events: Array<{ id: string; type: string; occurred_at: string; actor: { displayName?: string; display_name?: string; kind?: string }; payload: Record<string, unknown> }>;
  snapshots: Array<{ id: string; digest: string; created_at: string; manifest: Record<string, unknown> }>;
  verifications: Array<{ id: string; kind: string; status: string; summary: string; finished_at: string }>;
};

export function SessionClient() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [aggregate, setAggregate] = useState<Aggregate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = window.localStorage.getItem("sessions_api_token");
    if (!token) {
      setError("Connect your Sessions workspace before opening this Session.");
      setLoading(false);
      return;
    }
    const api = process.env.NEXT_PUBLIC_SESSIONS_API_URL || window.location.origin;
    fetch(`${api}/api/sessions/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
        return body as Aggregate;
      })
      .then(setAggregate)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load Session."))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <main className="session-page"><section className="section-narrow session-header"><h1>Loading Session…</h1><p>Retrieving authenticated engineering history.</p></section></main>;
  if (error || !aggregate) return <main className="session-page"><section className="section-narrow session-header"><h1>Session unavailable</h1><p>{error || "The Session could not be loaded."}</p><Link href="/onboarding" className="button sessions-primary">Connect workspace</Link></section></main>;

  const { session, events, snapshots, verifications } = aggregate;
  const failed = verifications.filter((item) => item.status !== "passed");
  const latestSnapshot = snapshots[0];

  return (
    <main className="session-page">
      <header className="session-topbar"><Link href="/dashboard" className="brand"><span className="brand-mark">S</span><span>Sessions</span></Link><div className="session-top-actions"><span className="capture-live"><i></i> Connected</span><Link href="/dashboard" className="button button-secondary">Repositories</Link></div></header>
      <section className="session-header section-narrow">
        <div className="breadcrumb"><Link href="/dashboard">Repositories</Link> / {session.repository_id} / Sessions / {id}</div>
        <div className="session-title-row"><div><h1>{session.objective}</h1><p>{session.repository_id} · started {new Date(session.created_at).toLocaleString()}</p></div></div>
        <div className="session-summary-strip"><div><span>Status</span><strong>{session.status}</strong></div><div><span>Activity</span><strong>{events.length}</strong></div><div><span>Commits</span><strong>{snapshots.length}</strong></div><div><span>Checks</span><strong>{verifications.length - failed.length}/{verifications.length} passed</strong></div><div><span>Recovery</span><strong className={latestSnapshot ? "success-text" : "warning-text"}>{latestSnapshot ? "Commit available" : "No commit"}</strong></div></div>
      </section>
      <section className="session-grid section-narrow">
        <div className="session-column-main">
          <article className="workspace-panel detail-panel"><div className="panel-head"><div><h2>Activity</h2><p>Repository activity with human and AI attribution.</p></div></div><div className="timeline">{events.length === 0 ? <p>No activity captured yet.</p> : events.map((event, index) => { const actor = event.actor ?? {}; const display = actor.displayName ?? actor.display_name ?? "Unknown actor"; const kind = actor.kind ?? "unknown"; return <div className="timeline-event" key={event.id}><div className={`actor-dot actor-${String(kind).replace("_", "-")}`}>{index + 1}</div><time>{new Date(event.occurred_at).toLocaleTimeString()}</time><div className="event-copy"><strong>{event.type}</strong><span>{display} · {String(kind).replace("_", " ")}</span><p>{JSON.stringify(event.payload)}</p></div></div>; })}</div></article>
          <article className="workspace-panel detail-panel"><div className="panel-head"><div><h2>Commits</h2><p>Immutable source states with Sessions verification, provenance, and recovery data.</p></div></div><div className="file-list">{snapshots.length === 0 ? <p>No commits recorded yet. Use <code>sessions commit</code>.</p> : snapshots.map((snapshot) => <div key={snapshot.id}><code>{snapshot.id}</code><span>{snapshot.digest.slice(0, 12)}</span><span>{new Date(snapshot.created_at).toLocaleTimeString()}</span></div>)}</div></article>
        </div>
        <aside className="session-column-side">
          <article className="workspace-panel detail-panel sticky-panel"><div className="panel-head"><div><h2>Checks</h2><p>Verification evidence attached to this Session.</p></div></div><div className="check-list">{verifications.length === 0 ? <p>No checks yet.</p> : verifications.map((check) => <div className="check-row" key={check.id}><span className={check.status === "passed" ? "check-pass" : "check-fail"}>{check.status === "passed" ? "✓" : "!"}</span><strong>{check.kind}</strong><span>{check.status}</span></div>)}</div>{failed.length > 0 && <div className="gate-callout"><strong>Review required</strong><p>{failed.length} check(s) are not passing.</p></div>}</article>
          <article className="workspace-panel detail-panel"><div className="panel-head"><div><h2>Recovery</h2><p>Restore from the nearest recorded commit.</p></div></div>{latestSnapshot ? <div className="checkpoint-card"><span>Latest commit</span><strong>{latestSnapshot.id}</strong><p>Digest {latestSnapshot.digest.slice(0, 16)}…</p><code>sessions restore {latestSnapshot.id}</code></div> : <p>Create a commit before consequential changes.</p>}</article>
        </aside>
      </section>
    </main>
  );
}
