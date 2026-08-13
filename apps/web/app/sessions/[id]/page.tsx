import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type Aggregate = {
  session: { id: string; repository_id: string; objective: string; status: string; created_at: string };
  events: Array<{ id: string; type: string; occurred_at: string; actor: { displayName?: string; display_name?: string; kind?: string }; payload: Record<string, unknown> }>;
  snapshots: Array<{ id: string; digest: string; created_at: string; manifest: Record<string, unknown> }>;
  verifications: Array<{ id: string; kind: string; status: string; summary: string; finished_at: string }>;
};

async function getSession(id: string): Promise<Aggregate | null> {
  const api = process.env.SESSIONS_API_URL ?? "http://localhost:4000";
  try {
    const response = await fetch(`${api}/api/sessions/${id}`, { cache: "no-store" });
    if (response.status === 404) return null;
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const aggregate = await getSession(id);
  if (!aggregate) notFound();
  const { session, events, snapshots, verifications } = aggregate;
  const failed = verifications.filter((item) => item.status !== "passed");
  const latestSnapshot = snapshots[0];

  return (
    <main className="session-page">
      <header className="session-topbar">
        <Link href="/dashboard" className="brand"><span className="brand-mark">S</span><span>Sessions</span></Link>
        <div className="session-top-actions"><span className="capture-live"><i></i> API connected</span><Link href="/dashboard" className="button button-secondary">Workspace</Link></div>
      </header>

      <section className="session-header section-narrow">
        <div className="breadcrumb"><Link href="/dashboard">Sessions</Link> / {id}</div>
        <div className="session-title-row"><div><h1>{session.objective}</h1><p>{session.repository_id} · started {new Date(session.created_at).toLocaleString()}</p></div></div>
        <div className="session-summary-strip">
          <div><span>Status</span><strong>{session.status}</strong></div>
          <div><span>Events</span><strong>{events.length}</strong></div>
          <div><span>Snapshots</span><strong>{snapshots.length}</strong></div>
          <div><span>Verification</span><strong>{verifications.length - failed.length}/{verifications.length} passed</strong></div>
          <div><span>Rollback</span><strong className={latestSnapshot ? "success-text" : "warning-text"}>{latestSnapshot ? "Checkpoint available" : "No checkpoint"}</strong></div>
        </div>
      </section>

      <section className="session-grid section-narrow">
        <div className="session-column-main">
          <article className="workspace-panel detail-panel">
            <div className="panel-head"><div><h2>Execution timeline</h2><p>The persisted attributable story of this Session.</p></div></div>
            <div className="timeline">
              {events.length === 0 ? <p>No events captured yet.</p> : events.map((event, index) => {
                const actor = event.actor ?? {};
                const display = actor.displayName ?? actor.display_name ?? "Unknown actor";
                const kind = actor.kind ?? "unknown";
                return (
                  <div className="timeline-event" key={event.id}>
                    <div className={`actor-dot actor-${String(kind).replace("_", "-")}`}>{index + 1}</div>
                    <time>{new Date(event.occurred_at).toLocaleTimeString()}</time>
                    <div className="event-copy"><strong>{event.type}</strong><span>{display} · {String(kind).replace("_", " ")}</span><p>{JSON.stringify(event.payload)}</p></div>
                  </div>
                );
              })}
            </div>
          </article>

          <article className="workspace-panel detail-panel">
            <div className="panel-head"><div><h2>CodeVault snapshots</h2><p>Immutable state checkpoints recorded for recovery and reconstruction.</p></div></div>
            <div className="file-list">
              {snapshots.length === 0 ? <p>No snapshots yet. Use <code>sessions checkpoint</code>.</p> : snapshots.map((snapshot) => (
                <div key={snapshot.id}><code>{snapshot.id}</code><span>{snapshot.digest.slice(0, 12)}</span><span>{new Date(snapshot.created_at).toLocaleTimeString()}</span></div>
              ))}
            </div>
          </article>
        </div>

        <aside className="session-column-side">
          <article className="workspace-panel detail-panel sticky-panel">
            <div className="panel-head"><div><h2>Verification</h2><p>Evidence attached to this Session.</p></div></div>
            <div className="check-list">
              {verifications.length === 0 ? <p>No verification evidence yet.</p> : verifications.map((check) => (
                <div className="check-row" key={check.id}><span className={check.status === "passed" ? "check-pass" : "check-fail"}>{check.status === "passed" ? "✓" : "!"}</span><strong>{check.kind}</strong><span>{check.status}</span></div>
              ))}
            </div>
            {failed.length > 0 && <div className="gate-callout"><strong>Review required</strong><p>{failed.length} verification record(s) are not passing.</p></div>}
          </article>

          <article className="workspace-panel detail-panel">
            <div className="panel-head"><div><h2>Recovery</h2><p>Nearest recorded rollback target.</p></div></div>
            {latestSnapshot ? <div className="checkpoint-card"><span>Latest checkpoint</span><strong>{latestSnapshot.id}</strong><p>Digest {latestSnapshot.digest.slice(0, 16)}…</p><code>sessions rollback {latestSnapshot.id}</code></div> : <p>Create a checkpoint before consequential changes.</p>}
          </article>
        </aside>
      </section>
    </main>
  );
}
