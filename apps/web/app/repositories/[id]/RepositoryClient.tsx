"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SessionsBrand } from "../../../components/SessionsBrand";

type Repository = { id:string; name:string; visibility:string; source_digest?:string|null; updated_at:string };
type Ref = { ref_type:string; name:string; checkpoint_id?:string|null; metadata?:Record<string,unknown> };
type Checkpoint = { id:string; friendlyName:string; sourceDigest:string; lifecycle:string; objective?:string; actorIds?:string[]; recovery?:{reconstructable:boolean;verified:boolean}; createdAt:string };
type RepositoryState = { version:number; protocol:string; repository:Repository; refs:Ref[]; checkpoints:Checkpoint[]; manifests:any[]; objects:Array<{objectId:string;digest:string;size:number}> };

export function RepositoryClient({ id }: { id:string }) {
  const [state,setState]=useState<RepositoryState|null>(null);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    const token=window.localStorage.getItem("sessions_api_token");
    if(!token){setError("Sign in to Sessions to open this repository.");setLoading(false);return;}
    const api=process.env.NEXT_PUBLIC_SESSIONS_API_URL||window.location.origin;
    fetch(`${api}/api/repositories/${encodeURIComponent(id)}/state`,{headers:{authorization:`Bearer ${token}`},cache:"no-store"})
      .then(async response=>{const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error??`HTTP ${response.status}`);return body as RepositoryState;})
      .then(setState).catch(reason=>setError(reason instanceof Error?reason.message:"Could not load repository.")).finally(()=>setLoading(false));
  },[id]);

  const branches=state?.refs.filter(ref=>ref.ref_type==="branch")??[];
  const tags=state?.refs.filter(ref=>ref.ref_type==="tag")??[];
  const head=state?.checkpoints[0];
  const verified=state?.checkpoints.filter(cp=>cp.recovery?.verified).length??0;
  const totalBytes=state?.objects.reduce((sum,item)=>sum+Number(item.size||0),0)??0;

  return <main className="sessions-app">
    <aside className="sessions-sidebar">
      <Link href="/" className="sessions-sidebar-brand"><SessionsBrand compact /></Link>
      <div className="sessions-side-section">Repository</div>
      <nav><a className="sessions-side-link active" href="#code"><span>Code</span></a><a className="sessions-side-link" href="#commits"><span>Commits</span><b>{state?.checkpoints.length??0}</b></a><a className="sessions-side-link" href="#branches"><span>Branches</span><b>{branches.length}</b></a><a className="sessions-side-link" href="#tags"><span>Tags</span><b>{tags.length}</b></a><a className="sessions-side-link" href="#issues"><span>Issues</span></a><a className="sessions-side-link" href="#pull-requests"><span>Pull requests</span></a><a className="sessions-side-link" href="#actions"><span>Actions</span></a><a className="sessions-side-link" href="#security"><span>Security</span></a><a className="sessions-side-link" href="#insights"><span>Insights</span></a><a className="sessions-side-link" href="#settings"><span>Settings</span></a></nav>
      <div className="sessions-side-section">Sessions</div>
      <nav><a className="sessions-side-link" href="#verification"><span>Verification</span><b>{verified}</b></a><a className="sessions-side-link" href="#recovery"><span>Recovery</span></a><a className="sessions-side-link" href="#provenance"><span>AI activity</span></a></nav>
    </aside>
    <section className="sessions-main">
      <header className="sessions-commandbar"><div className="sessions-commandbar-path"><Link href="/dashboard">Repositories</Link> / {state?.repository.name??id}</div><div className="sessions-search">⌕ <span>Search code, commits, issues, pull requests…</span><kbd>⌘ K</kbd></div><div className="sessions-command-actions"><Link className="button sessions-secondary" href="/install">Clone</Link></div></header>
      <div className="sessions-content">
        {loading?<div className="sessions-empty"><strong>Loading repository…</strong>Reading native Sessions refs, commits and source objects.</div>:null}
        {error?<div className="sessions-empty"><strong>Repository unavailable.</strong>{error}</div>:null}
        {state?<>
          <header className="sessions-page-head"><div><h1>{state.repository.name}</h1><p>{state.repository.visibility} · Sessions-native repository</p></div><div className="sessions-head-actions"><span className="button sessions-secondary">{branches.length} branches</span><span className="button sessions-secondary">{tags.length} tags</span></div></header>
          <section className="sessions-section" id="code"><div className="sessions-section-title"><h2>Code</h2><span>{state.objects.length} content objects · {(totalBytes/1024).toFixed(1)} KB</span></div><div className="sessions-side-panel"><div className="signal-row"><span>Protocol</span><strong>{state.protocol}</strong></div><div className="signal-row"><span>Source digest</span><strong>{state.repository.source_digest?.slice(0,16)??"No commit yet"}</strong></div><div className="signal-row"><span>Latest commit</span><strong>{head?.friendlyName??"No commits"}</strong></div><div className="signal-row"><span>Verified recovery commits</span><strong className="signal-good">{verified}/{state.checkpoints.length}</strong></div></div></section>
          <section className="sessions-section" id="commits"><div className="sessions-section-title"><h2>Commits</h2><span>Intent + provenance + recovery</span></div><div className="session-feed">{state.checkpoints.length?state.checkpoints.map(cp=><div className="feed-row" key={cp.id}><span className="feed-symbol">◆</span><span className="feed-copy"><strong>{cp.friendlyName}</strong><span>{cp.objective??"No objective recorded"} · {cp.lifecycle} · {cp.recovery?.verified?"verified recovery":"recovery pending"}</span></span><time>{new Date(cp.createdAt).toLocaleDateString()}</time></div>):<div className="sessions-empty"><strong>No commits yet.</strong>Create one with <code>sessions commit</code> and push it.</div>}</div></section>
          <section className="sessions-overview-grid"><section className="sessions-section" id="branches"><div className="sessions-section-title"><h2>Branches</h2><span>{branches.length}</span></div><div className="session-feed">{branches.map(ref=><div className="feed-row" key={ref.name}><span className="feed-symbol">⑂</span><span className="feed-copy"><strong>{ref.name}</strong><span>{ref.checkpoint_id??"No commit"}</span></span></div>)}</div></section><section className="sessions-section" id="tags"><div className="sessions-section-title"><h2>Tags</h2><span>{tags.length}</span></div><div className="session-feed">{tags.length?tags.map(ref=><div className="feed-row" key={ref.name}><span className="feed-symbol">◇</span><span className="feed-copy"><strong>{ref.name}</strong><span>{ref.checkpoint_id}</span></span></div>):<div className="sessions-empty">No tags.</div>}</div></section></section>
          <section className="sessions-section" id="verification"><div className="sessions-section-title"><h2>What Sessions adds</h2><span>Beyond conventional source control</span></div><div className="sessions-side-panel"><div className="signal-row"><span>Why the change exists</span><strong>Intent</strong></div><div className="signal-row"><span>Who/what made it</span><strong>Human + AI provenance</strong></div><div className="signal-row"><span>What actually ran</span><strong>Execution lineage</strong></div><div className="signal-row"><span>Proof the result works</span><strong>Verification evidence</strong></div><div className="signal-row"><span>Resume after interruption</span><strong>Recovery + continuation</strong></div></div></section>
        </>:null}
      </div>
    </section>
  </main>;
}
