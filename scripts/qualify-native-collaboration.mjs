import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const api = process.env.SESSIONS_API_QUALIFICATION_URL ?? "http://127.0.0.1:4000";
function stableJson(value){if(value===null||typeof value!=="object")return JSON.stringify(value);if(Array.isArray(value))return `[${value.map(stableJson).join(",")}]`;return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;}
const digest = (value) => createHash("sha256").update(value).digest("hex");
const treeDigest = (entries) => digest(stableJson(entries.map(({path,digest:hash,size})=>({path,digest:hash,size})).sort((a,b)=>a.path.localeCompare(b.path))));

async function rawRequest(path, options = {}) {
  const response = await fetch(`${api}${path}`, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}
async function request(path, options = {}) {
  const { response, body } = await rawRequest(path, options);
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${path}: ${response.status} ${body.error ?? JSON.stringify(body)}`);
  return body;
}
async function waitFor(label, fn, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${label} did not become ready`);
}
async function uploadObject(repositoryId, content) {
  const objectDigest = digest(content), objectId = `obj_${objectDigest}`;
  const plan = await request(`/api/repositories/${encodeURIComponent(repositoryId)}/objects/plan`, { method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({objects:[{objectId,digest:objectDigest,size:content.length}]}) });
  if (plan.missing.includes(objectId)) await request(`/api/repositories/${encodeURIComponent(repositoryId)}/objects/${encodeURIComponent(objectId)}?digest=${objectDigest}&size=${content.length}`, { method:"POST",headers:{"content-type":"application/octet-stream"},body:Uint8Array.from(content).buffer });
  return { objectId, digest: objectDigest, size: content.length };
}
function manifest(repositoryId, entries) {
  const sorted=[...entries].sort((a,b)=>a.path.localeCompare(b.path)),sourceDigest=treeDigest(sorted);
  const canonical={version:1,repositoryId,entries:sorted,sourceDigest};
  return {...canonical,id:`manifest_${digest(stableJson(canonical))}`};
}
function checkpoint({id,repositoryId,workstreamId,parentCheckpointIds,manifest,friendlyName,objective,createdAt}) {
  return {version:1,id,friendlyName,repositoryId,workstreamId,parentCheckpointIds,sourceManifestId:manifest.id,sourceDigest:manifest.sourceDigest,lifecycle:"verified",objective,actorIds:["human_local"],sessionIds:[],verificationIds:[],approvalIds:[],recovery:{reconstructable:true,verified:true},createdAt};
}
async function createRepository(name) {
  const stamp=`${Date.now()}_${Math.random().toString(16).slice(2)}`,repositoryId=`repo_${name}_${stamp}`,mainId=`workstream_main_${stamp}`,featureId=`workstream_feature_${stamp}`,createdAt=new Date().toISOString();
  const repository={version:1,id:repositoryId,name:`${name}-${stamp}`,createdAt,defaultWorkstreamId:mainId,hashAlgorithm:"sha256"};
  await request("/api/repositories",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id:repositoryId,name:repository.name,defaultBranchId:mainId,visibility:"private"})});
  return {repositoryId,repository,mainId,featureId,createdAt};
}
async function pushState(ctx,{branches,checkpoints,manifests,activeWorkstreamId,sourceDigest}) {
  const refs=branches.map(branch=>({refType:"branch",name:branch.name,checkpointId:branch.headCheckpointId,metadata:{id:branch.id,objective:branch.objective,createdAt:branch.createdAt,updatedAt:branch.updatedAt}}));
  return request(`/api/repositories/${encodeURIComponent(ctx.repositoryId)}/state`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({version:1,protocol:"sessions-native",state:{repository:ctx.repository,state:{activeWorkstreamId},branches,tags:[]},refs,checkpoints,manifests,sourceDigest})});
}
async function waitAction(repositoryId, actionRunId) {
  const action=await waitFor(`Action ${actionRunId}`,async()=>{const actions=await request(`/api/repositories/${encodeURIComponent(repositoryId)}/actions`);return actions.find(run=>run.id===actionRunId&&run.status==="completed")??null;});
  assert.equal(action.conclusion,"success");assert.equal(action.checks.length,3);assert.ok(action.checks.every(check=>check.conclusion==="success"));return action;
}
async function createVerifiedPull(repositoryId,{title,headCheckpointId}) {
  const pull=await request(`/api/repositories/${encodeURIComponent(repositoryId)}/pulls`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({title,baseBranch:"main",headBranch:"feature",headCommitId:headCheckpointId,requiredApprovals:0})});
  assert.ok(pull.actionRunId);await waitAction(repositoryId,pull.actionRunId);
  return waitFor(`PR ${pull.number} verification`,async()=>{const pulls=await request(`/api/repositories/${encodeURIComponent(repositoryId)}/pulls`);return pulls.find(item=>item.number===pull.number&&item.verification_state==="passed")??null;});
}

async function qualifyFastForward() {
  const ctx=await createRepository("native-ff");
  const baseObj=await uploadObject(ctx.repositoryId,Buffer.from("base\n")),headObj=await uploadObject(ctx.repositoryId,Buffer.from("feature\n"));
  const baseManifest=manifest(ctx.repositoryId,[{path:"app.txt",...baseObj}]),headManifest=manifest(ctx.repositoryId,[{path:"app.txt",...headObj}]);
  const baseId=`cp_${digest(`base:${ctx.repositoryId}`).slice(0,24)}`,headId=`cp_${digest(`head:${ctx.repositoryId}`).slice(0,24)}`;
  const base=checkpoint({id:baseId,repositoryId:ctx.repositoryId,workstreamId:ctx.mainId,parentCheckpointIds:[],manifest:baseManifest,friendlyName:"Base",objective:"Base",createdAt:ctx.createdAt});
  const head=checkpoint({id:headId,repositoryId:ctx.repositoryId,workstreamId:ctx.featureId,parentCheckpointIds:[baseId],manifest:headManifest,friendlyName:"Feature",objective:"Feature",createdAt:new Date(Date.now()+1).toISOString()});
  const branches=[{id:ctx.mainId,repositoryId:ctx.repositoryId,name:"main",headCheckpointId:baseId,createdAt:ctx.createdAt,updatedAt:ctx.createdAt},{id:ctx.featureId,repositoryId:ctx.repositoryId,name:"feature",headCheckpointId:headId,createdAt:ctx.createdAt,updatedAt:ctx.createdAt}];
  const pushed=await pushState(ctx,{branches,checkpoints:[base,head],manifests:[baseManifest,headManifest],activeWorkstreamId:ctx.featureId,sourceDigest:baseManifest.sourceDigest});await waitAction(ctx.repositoryId,pushed.actionRunId);
  const pr=await createVerifiedPull(ctx.repositoryId,{title:"Fast-forward native feature",headCheckpointId:headId});
  const merged=await request(`/api/repositories/${encodeURIComponent(ctx.repositoryId)}/pulls/${pr.number}/merge`,{method:"POST",headers:{"content-type":"application/json"},body:"{}"});
  assert.equal(merged.mergeMode,"fast_forward");assert.equal(merged.merge_commit_id,headId);
  const state=await request(`/api/repositories/${encodeURIComponent(ctx.repositoryId)}/state`),main=state.refs.find(ref=>ref.ref_type==="branch"&&ref.name==="main");
  assert.equal(main.checkpoint_id,headId);assert.equal(state.repository.source_digest,headManifest.sourceDigest);
  return {repositoryId:ctx.repositoryId,mergeCommitId:headId};
}

async function qualifyAutomaticDivergentMerge() {
  const ctx=await createRepository("native-divergent");
  const baseObj=await uploadObject(ctx.repositoryId,Buffer.from("base\n")),mainObj=await uploadObject(ctx.repositoryId,Buffer.from("main-only\n")),featureObj=await uploadObject(ctx.repositoryId,Buffer.from("feature-only\n"));
  const baseManifest=manifest(ctx.repositoryId,[{path:"base.txt",...baseObj}]);
  const mainManifest=manifest(ctx.repositoryId,[{path:"base.txt",...baseObj},{path:"main.txt",...mainObj}]);
  const featureManifest=manifest(ctx.repositoryId,[{path:"base.txt",...baseObj},{path:"feature.txt",...featureObj}]);
  const baseId=`cp_${digest(`base:${ctx.repositoryId}`).slice(0,24)}`,mainId=`cp_${digest(`main:${ctx.repositoryId}`).slice(0,24)}`,featureId=`cp_${digest(`feature:${ctx.repositoryId}`).slice(0,24)}`;
  const base=checkpoint({id:baseId,repositoryId:ctx.repositoryId,workstreamId:ctx.mainId,parentCheckpointIds:[],manifest:baseManifest,friendlyName:"Base",objective:"Base",createdAt:ctx.createdAt});
  const main=checkpoint({id:mainId,repositoryId:ctx.repositoryId,workstreamId:ctx.mainId,parentCheckpointIds:[baseId],manifest:mainManifest,friendlyName:"Main change",objective:"Main change",createdAt:new Date(Date.now()+1).toISOString()});
  const feature=checkpoint({id:featureId,repositoryId:ctx.repositoryId,workstreamId:ctx.featureId,parentCheckpointIds:[baseId],manifest:featureManifest,friendlyName:"Feature change",objective:"Feature change",createdAt:new Date(Date.now()+2).toISOString()});
  const branches=[{id:ctx.mainId,repositoryId:ctx.repositoryId,name:"main",headCheckpointId:mainId,createdAt:ctx.createdAt,updatedAt:ctx.createdAt},{id:ctx.featureId,repositoryId:ctx.repositoryId,name:"feature",headCheckpointId:featureId,createdAt:ctx.createdAt,updatedAt:ctx.createdAt}];
  const pushed=await pushState(ctx,{branches,checkpoints:[base,main,feature],manifests:[baseManifest,mainManifest,featureManifest],activeWorkstreamId:ctx.featureId,sourceDigest:mainManifest.sourceDigest});await waitAction(ctx.repositoryId,pushed.actionRunId);
  const pr=await createVerifiedPull(ctx.repositoryId,{title:"Automatic clean native merge",headCheckpointId:featureId});
  const merged=await request(`/api/repositories/${encodeURIComponent(ctx.repositoryId)}/pulls/${pr.number}/merge`,{method:"POST",headers:{"content-type":"application/json"},body:"{}"});
  assert.equal(merged.mergeMode,"native_merge");assert.notEqual(merged.merge_commit_id,mainId);assert.notEqual(merged.merge_commit_id,featureId);assert.ok(merged.mergeVerificationActionId);
  await waitAction(ctx.repositoryId,merged.mergeVerificationActionId);
  const state=await request(`/api/repositories/${encodeURIComponent(ctx.repositoryId)}/state`),mainRef=state.refs.find(ref=>ref.ref_type==="branch"&&ref.name==="main"),mergeCommit=state.checkpoints.find(cp=>cp.id===merged.merge_commit_id);
  assert.equal(mainRef.checkpoint_id,merged.merge_commit_id);assert.deepEqual(new Set(mergeCommit.parentCheckpointIds),new Set([mainId,featureId]));
  const mergeManifest=state.manifests.find(item=>item.id===mergeCommit.sourceManifestId);assert.deepEqual(mergeManifest.entries.map(entry=>entry.path).sort(),["base.txt","feature.txt","main.txt"]);assert.equal(state.repository.source_digest,mergeCommit.sourceDigest);
  return {repositoryId:ctx.repositoryId,mergeCommitId:merged.merge_commit_id,verificationActionId:merged.mergeVerificationActionId};
}

async function qualifyConflictRejection() {
  const ctx=await createRepository("native-conflict");
  const baseObj=await uploadObject(ctx.repositoryId,Buffer.from("base\n")),mainObj=await uploadObject(ctx.repositoryId,Buffer.from("main\n")),featureObj=await uploadObject(ctx.repositoryId,Buffer.from("feature\n"));
  const baseManifest=manifest(ctx.repositoryId,[{path:"app.txt",...baseObj}]),mainManifest=manifest(ctx.repositoryId,[{path:"app.txt",...mainObj}]),featureManifest=manifest(ctx.repositoryId,[{path:"app.txt",...featureObj}]);
  const baseId=`cp_${digest(`base:${ctx.repositoryId}`).slice(0,24)}`,mainId=`cp_${digest(`main:${ctx.repositoryId}`).slice(0,24)}`,featureId=`cp_${digest(`feature:${ctx.repositoryId}`).slice(0,24)}`;
  const base=checkpoint({id:baseId,repositoryId:ctx.repositoryId,workstreamId:ctx.mainId,parentCheckpointIds:[],manifest:baseManifest,friendlyName:"Base",objective:"Base",createdAt:ctx.createdAt});
  const main=checkpoint({id:mainId,repositoryId:ctx.repositoryId,workstreamId:ctx.mainId,parentCheckpointIds:[baseId],manifest:mainManifest,friendlyName:"Main conflict",objective:"Main conflict",createdAt:new Date(Date.now()+1).toISOString()});
  const feature=checkpoint({id:featureId,repositoryId:ctx.repositoryId,workstreamId:ctx.featureId,parentCheckpointIds:[baseId],manifest:featureManifest,friendlyName:"Feature conflict",objective:"Feature conflict",createdAt:new Date(Date.now()+2).toISOString()});
  const branches=[{id:ctx.mainId,repositoryId:ctx.repositoryId,name:"main",headCheckpointId:mainId,createdAt:ctx.createdAt,updatedAt:ctx.createdAt},{id:ctx.featureId,repositoryId:ctx.repositoryId,name:"feature",headCheckpointId:featureId,createdAt:ctx.createdAt,updatedAt:ctx.createdAt}];
  const pushed=await pushState(ctx,{branches,checkpoints:[base,main,feature],manifests:[baseManifest,mainManifest,featureManifest],activeWorkstreamId:ctx.featureId,sourceDigest:mainManifest.sourceDigest});await waitAction(ctx.repositoryId,pushed.actionRunId);
  const pr=await createVerifiedPull(ctx.repositoryId,{title:"Conflicting native merge",headCheckpointId:featureId});
  const {response,body}=await rawRequest(`/api/repositories/${encodeURIComponent(ctx.repositoryId)}/pulls/${pr.number}/merge`,{method:"POST",headers:{"content-type":"application/json"},body:"{}"});
  assert.equal(response.status,409);assert.match(String(body.error),/native merge conflicts: app\.txt/);
  const state=await request(`/api/repositories/${encodeURIComponent(ctx.repositoryId)}/state`),mainRef=state.refs.find(ref=>ref.ref_type==="branch"&&ref.name==="main");assert.equal(mainRef.checkpoint_id,mainId,"conflicting merge must not advance main");
  return {repositoryId:ctx.repositoryId,mainCommitId:mainId,conflict:body.error};
}

const fastForward=await qualifyFastForward();
const divergent=await qualifyAutomaticDivergentMerge();
const conflict=await qualifyConflictRejection();
console.log(JSON.stringify({ok:true,protocol:"sessions-native",fastForward,divergent,conflict},null,2));
