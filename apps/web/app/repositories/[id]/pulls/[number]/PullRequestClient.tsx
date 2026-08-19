"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type Review={id:string;state:string;body:string;submitted_at:string};
type Comment={id:string;body:string;path?:string|null;line?:number|null;created_at:string};
type Check={id:string;name:string;category:string;status:string;conclusion?:string|null;summary:string;evidence?:Record<string,unknown>};
type Pull={id:string;number:number;title:string;body:string;state:string;base_branch:string;head_branch:string;head_commit_id:string;merge_commit_id?:string|null;draft:boolean;verification_state:string;mergeable:boolean;required_approvals:number;created_at:string;merged_at?:string|null;comments:Comment[];reviews:Review[];checks:Check[]};

export function PullRequestClient({id,number}:{id:string;number:number}){
  const [pull,setPull]=useState<Pull|null>(null);
  const [comment,setComment]=useState("");
  const [reviewBody,setReviewBody]=useState("");
  const [error,setError]=useState("");
  const [working,setWorking]=useState("");
  const api=typeof window!=="undefined"?(process.env.NEXT_PUBLIC_SESSIONS_API_URL||window.location.origin):"";
  const token=typeof window!=="undefined"?window.localStorage.getItem("sessions_api_token"):null;
  const headers=useMemo(()=>({authorization:`Bearer ${token??""}`,"content-type":"application/json"}),[token]);

  const load=useCallback(async()=>{
    if(!token){setError("Sign in to Sessions to view this pull request.");return;}
    const response=await fetch(`${api}/api/repositories/${encodeURIComponent(id)}/pulls/${number}`,{headers,cache:"no-store"});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(payload.error??`HTTP ${response.status}`);
    setPull(payload as Pull);
  },[api,headers,id,number,token]);

  useEffect(()=>{load().catch(reason=>setError(reason instanceof Error?reason.message:"Could not load pull request."));},[load]);
  useEffect(()=>{if(!pull||pull.state!=="open"||pull.verification_state!=="pending")return;const timer=setInterval(()=>load().catch(()=>undefined),1000);return()=>clearInterval(timer);},[load,pull]);

  async function post(path:string,payload:unknown,label:string){
    setError("");setWorking(label);
    try{const response=await fetch(`${api}${path}`,{method:"POST",headers,body:JSON.stringify(payload)});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error??`HTTP ${response.status}`);await load();return body;}catch(reason){setError(reason instanceof Error?reason.message:"Request failed.");throw reason;}finally{setWorking("");}
  }

  async function addComment(){if(!comment.trim())return;await post(`/api/repositories/${encodeURIComponent(id)}/pulls/${number}/comments`,{body:comment.trim()},"comment").then(()=>setComment("")).catch(()=>undefined);}
  async function review(state:"approved"|"changes_requested"|"commented"){await post(`/api/repositories/${encodeURIComponent(id)}/pulls/${number}/reviews`,{state,body:reviewBody.trim()},state).then(()=>setReviewBody("")).catch(()=>undefined);}
  async function merge(){await post(`/api/repositories/${encodeURIComponent(id)}/pulls/${number}/merge`,{},"merge").catch(()=>undefined);}

  const approvals=pull?.reviews.filter(r=>r.state==="approved").length??0;
  const failures=pull?.checks.filter(c=>c.conclusion==="failure").length??0;
  const pending=pull?.checks.filter(c=>c.status!=="completed").length??0;
  const canMerge=!!pull&&pull.state==="open"&&!pull.draft&&pull.verification_state==="passed"&&failures===0&&pending===0&&approvals>=pull.required_approvals;

  return <main className="section-narrow" style={{paddingTop:34,paddingBottom:72}}>
    <div className="breadcrumb"><Link href={`/repositories/${encodeURIComponent(id)}`}>Repository</Link> / Pull requests / #{number}</div>
    {error?<div className="sessions-empty" style={{marginBottom:16}}><strong>Pull request action failed.</strong>{error}</div>:null}
    {!pull?<div className="sessions-empty"><strong>Loading pull request…</strong>Reading native verification, reviews, and merge state.</div>:<>
      <header className="workspace-header" style={{alignItems:"flex-start",marginBottom:22}}><div><h1>#{pull.number} {pull.title}</h1><p>{pull.head_branch} → {pull.base_branch} · {pull.state}{pull.draft?" · draft":""}</p></div><div style={{display:"flex",gap:8,alignItems:"center"}}><span className={`status-pill ${pull.verification_state==="passed"?"status-good":"status-warn"}`}>{pull.verification_state}</span>{pull.state==="open"?<button className="button button-primary" disabled={!canMerge||working==="merge"} onClick={merge}>{working==="merge"?"Merging…":"Merge"}</button>:null}</div></header>

      <section className="workspace-panel" style={{padding:22,marginBottom:16}}><div style={{color:"var(--muted)",lineHeight:1.7,whiteSpace:"pre-wrap"}}>{pull.body||"No description provided."}</div><div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginTop:20}}><Metric label="Head commit" value={pull.head_commit_id?.slice(0,14)??"none"}/><Metric label="Verification" value={pull.verification_state}/><Metric label="Approvals" value={`${approvals}/${pull.required_approvals}`}/><Metric label="Mergeability" value={canMerge?"ready":pull.state==="merged"?"merged":"blocked"}/></div></section>

      <section className="workspace-panel" style={{marginBottom:16}}><div className="panel-head"><div><h2>Native verification</h2><p>Sessions verifies source integrity, repository consistency, and recovery readiness.</p></div></div><div>{pull.checks.length?pull.checks.map(check=><div className="session-row" key={check.id} style={{gridTemplateColumns:"34px 1fr auto"}}><span className="session-icon">{check.conclusion==="success"?"✓":check.conclusion==="failure"?"×":"·"}</span><div className="session-primary"><strong>{check.name}</strong><span>{check.summary||`${check.category} · ${check.status}`}</span></div><span className={`status-pill ${check.conclusion==="success"?"status-good":"status-warn"}`}>{check.conclusion??check.status}</span></div>):<div className="sessions-empty">Verification checks are being prepared.</div>}</div></section>

      <section className="workspace-panel" style={{padding:22,marginBottom:16}}><h2 style={{fontSize:15,marginTop:0}}>Review</h2><textarea rows={4} value={reviewBody} onChange={e=>setReviewBody(e.target.value)} placeholder="Leave review notes…" style={fieldStyle}/><div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:12,flexWrap:"wrap"}}><button className="button button-secondary" onClick={()=>review("commented")} disabled={!!working}>Comment</button><button className="button button-danger" onClick={()=>review("changes_requested")} disabled={!!working}>Request changes</button><button className="button button-primary" onClick={()=>review("approved")} disabled={!!working}>Approve</button></div>{pull.reviews.length?<div style={{marginTop:18,display:"grid",gap:8}}>{pull.reviews.map(review=><div className="signal-row" key={review.id}><span>{review.body||"No review note"}</span><strong>{review.state}</strong></div>)}</div>:null}</section>

      <section className="workspace-panel" style={{padding:22}}><h2 style={{fontSize:15,marginTop:0}}>Conversation</h2>{pull.comments.length?<div style={{display:"grid",gap:10,marginBottom:16}}>{pull.comments.map(item=><div key={item.id} style={{border:"1px solid var(--border-soft)",borderRadius:10,padding:13,color:"var(--muted)",whiteSpace:"pre-wrap"}}>{item.body}</div>)}</div>:<p style={{color:"var(--muted-2)",fontSize:12}}>No comments yet.</p>}<textarea rows={3} value={comment} onChange={e=>setComment(e.target.value)} placeholder="Add a comment…" style={fieldStyle}/><div style={{display:"flex",justifyContent:"flex-end",marginTop:10}}><button className="button button-secondary" onClick={addComment} disabled={!comment.trim()||working==="comment"}>{working==="comment"?"Posting…":"Comment"}</button></div></section>
    </>}
  </main>;
}

function Metric({label,value}:{label:string;value:string}){return <div className="metric-card"><span>{label}</span><strong style={{fontSize:16}}>{value}</strong></div>}
const fieldStyle:React.CSSProperties={width:"100%",borderRadius:9,border:"1px solid var(--border)",background:"#0b1017",color:"var(--text)",padding:12,font:"inherit",resize:"vertical"};
