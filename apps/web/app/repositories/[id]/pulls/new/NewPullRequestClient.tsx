"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Ref={ref_type:string;name:string;checkpoint_id?:string|null};
type RepositoryState={repository:{name:string};refs:Ref[]};

export function NewPullRequestClient({id}:{id:string}){
  const [state,setState]=useState<RepositoryState|null>(null);
  const [baseBranch,setBaseBranch]=useState("main");
  const [headBranch,setHeadBranch]=useState("");
  const [title,setTitle]=useState("");
  const [body,setBody]=useState("");
  const [requiredApprovals,setRequiredApprovals]=useState(1);
  const [draft,setDraft]=useState(false);
  const [error,setError]=useState("");
  const [saving,setSaving]=useState(false);

  const api=typeof window!=="undefined"?(process.env.NEXT_PUBLIC_SESSIONS_API_URL||window.location.origin):"";
  const token=typeof window!=="undefined"?window.localStorage.getItem("sessions_api_token"):null;
  const headers=useMemo(()=>({authorization:`Bearer ${token??""}`,"content-type":"application/json"}),[token]);

  useEffect(()=>{
    if(!token){setError("Sign in to Sessions before creating a pull request.");return;}
    fetch(`${api}/api/repositories/${encodeURIComponent(id)}/state`,{headers,cache:"no-store"})
      .then(async response=>{const payload=await response.json();if(!response.ok)throw new Error(payload.error??`HTTP ${response.status}`);return payload;})
      .then((payload:RepositoryState)=>{setState(payload);const branches=payload.refs.filter(ref=>ref.ref_type==="branch");const main=branches.find(ref=>ref.name==="main")??branches[0];const other=branches.find(ref=>ref.name!==main?.name);if(main)setBaseBranch(main.name);if(other)setHeadBranch(other.name);})
      .catch(reason=>setError(reason instanceof Error?reason.message:"Could not load repository branches."));
  },[api,headers,id,token]);

  const branches=state?.refs.filter(ref=>ref.ref_type==="branch")??[];
  const headRef=branches.find(ref=>ref.name===headBranch);

  async function submit(){
    setError("");
    if(!title.trim())return setError("Title is required.");
    if(!baseBranch||!headBranch)return setError("Choose both base and head branches.");
    if(baseBranch===headBranch)return setError("Base and head branches must be different.");
    if(!headRef?.checkpoint_id)return setError("The head branch has no native Sessions commit to review.");
    setSaving(true);
    try{
      const response=await fetch(`${api}/api/repositories/${encodeURIComponent(id)}/pulls`,{method:"POST",headers,body:JSON.stringify({title:title.trim(),body,baseBranch,headBranch,headCommitId:headRef.checkpoint_id,requiredApprovals,draft})});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(payload.error??`HTTP ${response.status}`);
      window.location.href=`/repositories/${encodeURIComponent(id)}/pulls/${payload.number}`;
    }catch(reason){setError(reason instanceof Error?reason.message:"Could not create pull request.");setSaving(false);}
  }

  return <main className="section-narrow" style={{paddingTop:36,paddingBottom:72}}>
    <div className="breadcrumb"><Link href={`/repositories/${encodeURIComponent(id)}`}>{state?.repository.name??id}</Link> / Pull requests / New</div>
    <header className="workspace-header" style={{marginBottom:24}}><div><h1>Open a native Sessions pull request</h1><p>Compare two Sessions branches, verify the head commit automatically, then merge only after evidence and review requirements pass.</p></div></header>
    <section className="workspace-panel" style={{padding:24}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:18}}>
        <label style={{display:"grid",gap:7,color:"var(--muted)",fontSize:12}}>Base branch<select value={baseBranch} onChange={e=>setBaseBranch(e.target.value)} style={fieldStyle}>{branches.map(ref=><option key={ref.name}>{ref.name}</option>)}</select></label>
        <label style={{display:"grid",gap:7,color:"var(--muted)",fontSize:12}}>Head branch<select value={headBranch} onChange={e=>setHeadBranch(e.target.value)} style={fieldStyle}><option value="">Choose branch</option>{branches.map(ref=><option key={ref.name}>{ref.name}</option>)}</select></label>
      </div>
      <label style={labelStyle}>Title<input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Describe the change" style={fieldStyle}/></label>
      <label style={labelStyle}>Description<textarea value={body} onChange={e=>setBody(e.target.value)} placeholder="Explain intent, expected behavior, risks, and anything reviewers should know." rows={8} style={{...fieldStyle,resize:"vertical",paddingTop:12}}/></label>
      <div style={{display:"flex",gap:18,alignItems:"center",flexWrap:"wrap",marginTop:18}}>
        <label style={{display:"flex",alignItems:"center",gap:8,color:"var(--muted)",fontSize:12}}>Required approvals<input type="number" min={0} max={20} value={requiredApprovals} onChange={e=>setRequiredApprovals(Math.max(0,Number(e.target.value)||0))} style={{...fieldStyle,width:72}}/></label>
        <label style={{display:"flex",alignItems:"center",gap:8,color:"var(--muted)",fontSize:12}}><input type="checkbox" checked={draft} onChange={e=>setDraft(e.target.checked)}/>Draft</label>
        <span style={{color:"var(--muted-2)",fontSize:11}}>Head commit: {headRef?.checkpoint_id??"none"}</span>
      </div>
      {error?<div className="sessions-empty" style={{marginTop:18}}><strong>Cannot create pull request.</strong>{error}</div>:null}
      <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:22}}><Link className="button button-secondary" href={`/repositories/${encodeURIComponent(id)}#pull-requests`}>Cancel</Link><button className="button button-primary" onClick={submit} disabled={saving}>{saving?"Creating…":"Create pull request"}</button></div>
    </section>
  </main>;
}

const fieldStyle:React.CSSProperties={minHeight:42,borderRadius:9,border:"1px solid var(--border)",background:"#0b1017",color:"var(--text)",padding:"0 11px",font:"inherit",width:"100%"};
const labelStyle:React.CSSProperties={display:"grid",gap:7,color:"var(--muted)",fontSize:12,marginBottom:16};
