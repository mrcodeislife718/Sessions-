import Link from "next/link";

const timeline = [
  { time: "10:41:08", actor: "Charles", type: "human", title: "Started Session", detail: "Objective: Fix auth regression without changing public session behavior." },
  { time: "10:41:19", actor: "Planner", type: "ai-system", title: "Created execution plan", detail: "Inspect refresh-token path, reproduce regression, patch smallest affected surface, verify." },
  { time: "10:41:43", actor: "Investigator", type: "ai-agent", title: "Inspected repository", detail: "Read 18 files and traced session refresh through auth middleware and token rotation." },
  { time: "10:42:03", actor: "Implementer", type: "ai-agent", title: "Changed 3 files", detail: "Modified auth/session.ts, auth/refresh.ts, and refresh.spec.ts." },
  { time: "10:42:34", actor: "Sessions", type: "service", title: "Verification failed", detail: "7/9 checks passed. Two refresh-token integration tests failed." },
  { time: "10:42:36", actor: "Sessions", type: "service", title: "Stable checkpoint found", detail: "snap_8f31a2 is verified and available as a rollback target." },
];

const checks = [
  ["Lint", "Passed", "418 ms"],
  ["Typecheck", "Passed", "1.2 s"],
  ["Unit tests", "Passed", "3.8 s"],
  ["Integration tests", "Failed", "6.4 s"],
  ["Build", "Passed", "8.1 s"],
  ["Security", "Passed", "722 ms"],
];

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <main className="session-page">
      <header className="session-topbar">
        <Link href="/dashboard" className="brand"><span className="brand-mark">S</span><span>Sessions</span></Link>
        <div className="session-top-actions"><span className="capture-live"><i></i> Capture connected</span><button className="button button-secondary">Share</button></div>
      </header>

      <section className="session-header section-narrow">
        <div className="breadcrumb"><Link href="/dashboard">Sessions</Link> / {id}</div>
        <div className="session-title-row">
          <div><h1>Fix auth regression</h1><p>acme/web · fix/session-refresh · started 8 minutes ago</p></div>
          <div className="session-actions"><button className="button button-secondary">Replay</button><button className="button button-danger">Rollback</button></div>
        </div>
        <div className="session-summary-strip">
          <div><span>Status</span><strong className="warning-text">Needs review</strong></div>
          <div><span>Participants</span><strong>1 human · 1 AI system · 2 agents</strong></div>
          <div><span>Changes</span><strong>3 files · +42 / −16</strong></div>
          <div><span>Verification</span><strong>7 / 9 passed</strong></div>
          <div><span>Rollback</span><strong className="success-text">Safe · 96%</strong></div>
        </div>
      </section>

      <section className="session-grid section-narrow">
        <div className="session-column-main">
          <article className="workspace-panel detail-panel">
            <div className="panel-head"><div><h2>Execution timeline</h2><p>The complete attributable story of this change.</p></div><button className="text-button">View raw events</button></div>
            <div className="timeline">
              {timeline.map((event, index) => (
                <div className="timeline-event" key={`${event.time}-${event.title}`}>
                  <div className={`actor-dot actor-${event.type}`}>{index + 1}</div>
                  <time>{event.time}</time>
                  <div className="event-copy"><strong>{event.title}</strong><span>{event.actor} · {event.type.replace("-", " ")}</span><p>{event.detail}</p></div>
                </div>
              ))}
            </div>
          </article>

          <article className="workspace-panel detail-panel">
            <div className="panel-head"><div><h2>Changes</h2><p>Semantic summary before raw diff.</p></div><span className="risk-badge">Medium risk</span></div>
            <div className="semantic-summary">
              <h3>What changed</h3>
              <p>Refresh-token rotation was tightened to reject stale token reuse. The implementation also changed when session metadata is persisted.</p>
              <h3>Why Sessions flagged it</h3>
              <p>The persistence timing change affects an authentication invariant used by two integration tests. No public API shape changed.</p>
            </div>
            <div className="file-list">
              <div><code>src/auth/session.ts</code><span className="diff-plus">+18</span><span className="diff-minus">−6</span></div>
              <div><code>src/auth/refresh.ts</code><span className="diff-plus">+16</span><span className="diff-minus">−8</span></div>
              <div><code>test/refresh.spec.ts</code><span className="diff-plus">+8</span><span className="diff-minus">−2</span></div>
            </div>
          </article>
        </div>

        <aside className="session-column-side">
          <article className="workspace-panel detail-panel sticky-panel">
            <div className="panel-head"><div><h2>Verification</h2><p>Evidence attached to this state.</p></div></div>
            <div className="check-list">
              {checks.map(([name, status, duration]) => (
                <div className="check-row" key={name}><span className={status === "Passed" ? "check-pass" : "check-fail"}>{status === "Passed" ? "✓" : "!"}</span><strong>{name}</strong><span>{duration}</span></div>
              ))}
            </div>
            <div className="gate-callout"><strong>Release blocked</strong><p>Resolve or explicitly approve the failing integration evidence before deployment.</p></div>
          </article>

          <article className="workspace-panel detail-panel">
            <div className="panel-head"><div><h2>Recovery</h2><p>Your nearest known-good state.</p></div></div>
            <div className="checkpoint-card"><span>Verified checkpoint</span><strong>snap_8f31a2</strong><p>Created before implementation · all 9 checks passed</p><button className="button button-secondary button-full">Preview rollback</button></div>
          </article>
        </aside>
      </section>
    </main>
  );
}
