import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";

export type ActionResult={processed:boolean;runId?:string;repositoryId?:string;commitId?:string;conclusion?:"success"|"failure"};
function hash(content:Buffer){return createHash("sha256").update(content).digest("hex");}
type CheckOutcome={conclusion:"success"|"failure";summary:string;evidence:Record<string,unknown>};

async function sourceIntegrity(client:PoolClient,repositoryId:string,commitId:string):Promise<CheckOutcome>{
  const checkpoint=(await client.query("select record from sessions_repository_checkpoints where repository_id=$1 and checkpoint_id=$2",[repositoryId,commitId])).rows[0]?.record;
  if(!checkpoint)return{conclusion:"failure",summary:"Commit record is missing from native repository storage.",evidence:{commitId}};
  const manifestId=checkpoint.sourceManifestId;
  const manifest=(await client.query("select manifest from repository_manifests where repository_id=$1 and id=$2",[repositoryId,manifestId])).rows[0]?.manifest;
  if(!manifest)return{conclusion:"failure",summary:"Commit source manifest is missing.",evidence:{commitId,manifestId}};
  let checked=0,totalBytes=0;
  for(const entry of manifest.entries??[]){
    const object=(await client.query("select digest,size_bytes,content from sessions_repository_objects where repository_id=$1 and object_id=$2",[repositoryId,entry.objectId])).rows[0];
    if(!object)return{conclusion:"failure",summary:`Source object missing: ${entry.path}`,evidence:{path:entry.path,objectId:entry.objectId}};
    const content=Buffer.from(object.content),actual=hash(content);
    if(actual!==entry.digest||actual!==object.digest||content.length!==Number(entry.size)||content.length!==Number(object.size_bytes))return{conclusion:"failure",summary:`Source integrity failed: ${entry.path}`,evidence:{path:entry.path,objectId:entry.objectId,expectedDigest:entry.digest,actualDigest:actual,expectedSize:entry.size,actualSize:content.length}};
    checked+=1;totalBytes+=content.length;
  }
  return{conclusion:"success",summary:`Verified ${checked} source objects (${totalBytes} bytes).`,evidence:{checkedObjects:checked,totalBytes,manifestId,commitId}};
}

async function repositoryPolicy(client:PoolClient,repositoryId:string,commitId:string):Promise<CheckOutcome>{
  const refs=await client.query("select ref_type,name,checkpoint_id from sessions_repository_refs where repository_id=$1",[repositoryId]);
  const known=await client.query("select checkpoint_id from sessions_repository_checkpoints where repository_id=$1",[repositoryId]);
  const ids=new Set(known.rows.map(r=>String(r.checkpoint_id)));
  const dangling=refs.rows.filter(ref=>ref.checkpoint_id&&!ids.has(String(ref.checkpoint_id)));
  if(dangling.length)return{conclusion:"failure",summary:`${dangling.length} repository ref(s) point to missing commits.`,evidence:{danglingRefs:dangling}};
  if(!ids.has(commitId))return{conclusion:"failure",summary:"Action commit is not present in native commit storage.",evidence:{commitId}};
  return{conclusion:"success",summary:`Repository refs are internally consistent across ${refs.rowCount??0} refs.`,evidence:{refs:refs.rowCount??0,commits:ids.size}};
}

async function recoveryReadiness(client:PoolClient,repositoryId:string,commitId:string):Promise<CheckOutcome>{
  const checkpoint=(await client.query("select record from sessions_repository_checkpoints where repository_id=$1 and checkpoint_id=$2",[repositoryId,commitId])).rows[0]?.record;
  if(!checkpoint)return{conclusion:"failure",summary:"Recovery check cannot find the commit.",evidence:{commitId}};
  const recovery=checkpoint.recovery??{};
  const manifestExists=Boolean((await client.query("select 1 from repository_manifests where repository_id=$1 and id=$2",[repositoryId,checkpoint.sourceManifestId])).rowCount);
  const ready=Boolean(recovery.reconstructable)&&manifestExists;
  return ready?{conclusion:"success",summary:"Commit is reconstructable from durable Sessions objects and manifest.",evidence:{commitId,sourceManifestId:checkpoint.sourceManifestId,recovery}}:{conclusion:"failure",summary:"Commit is not yet reconstructable from durable Sessions state.",evidence:{commitId,sourceManifestId:checkpoint.sourceManifestId,recovery,manifestExists}};
}

async function executeCheck(client:PoolClient,name:string,repositoryId:string,commitId:string):Promise<CheckOutcome>{
  if(name==="Source integrity")return sourceIntegrity(client,repositoryId,commitId);
  if(name==="Repository policy")return repositoryPolicy(client,repositoryId,commitId);
  if(name==="Recovery readiness")return recoveryReadiness(client,repositoryId,commitId);
  return{conclusion:"failure",summary:`Unknown Sessions Action check: ${name}`,evidence:{name}};
}

export async function runActionOnce(pool:Pool):Promise<ActionResult>{
  const client=await pool.connect();
  try{
    await client.query("begin");
    const selected=await client.query(`select * from action_runs where status='queued' and trigger in ('sessions.push','commit','pull_request') order by created_at for update skip locked limit 1`);
    if(!selected.rowCount){await client.query("commit");return{processed:false};}
    const run=selected.rows[0];
    if(!run.commit_id){await client.query("update action_runs set status='completed',conclusion='failure',started_at=now(),completed_at=now() where id=$1",[run.id]);if(run.pull_request_id)await client.query("update pull_requests set verification_state='failed',mergeable=false,updated_at=now() where id=$1",[run.pull_request_id]);await client.query("commit");return{processed:true,runId:run.id,repositoryId:run.repository_id,conclusion:"failure"};}
    await client.query("update action_runs set status='running',started_at=now() where id=$1",[run.id]);
    const checks=await client.query("select * from action_checks where action_run_id=$1 order by name",[run.id]);
    let failed=false;
    for(const check of checks.rows){
      await client.query("update action_checks set status='running',started_at=now() where id=$1",[check.id]);
      const outcome=await executeCheck(client,check.name,run.repository_id,run.commit_id);
      if(outcome.conclusion==="failure")failed=true;
      await client.query("update action_checks set status='completed',conclusion=$2,summary=$3,evidence=$4,completed_at=now() where id=$1",[check.id,outcome.conclusion,outcome.summary,JSON.stringify(outcome.evidence)]);
    }
    const conclusion=failed?"failure":"success";
    await client.query("update action_runs set status='completed',conclusion=$2,completed_at=now() where id=$1",[run.id,conclusion]);
    if(run.pull_request_id){
      if(failed)await client.query("update pull_requests set verification_state='failed',mergeable=false,updated_at=now() where id=$1",[run.pull_request_id]);
      else await client.query("update pull_requests set verification_state='passed',updated_at=now() where id=$1",[run.pull_request_id]);
    }
    await client.query("commit");
    return{processed:true,runId:run.id,repositoryId:run.repository_id,commitId:run.commit_id,conclusion};
  }catch(error){await client.query("rollback");throw error;}finally{client.release();}
}
