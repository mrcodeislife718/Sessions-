import { execFile } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { checkoutWorkstream, createCheckpoint, createWorkstream, getActiveWorkstream, getCheckpoint, getSourceManifest, initializeRepository, listHistory, listWorkstreams, openRepository, repositoryStatus, restoreCheckpoint, stagePaths } from "./core.js";

const execFileAsync = promisify(execFile);
type Remote={name:string;url:string;fetch?:string;push?:string};
type RemoteConfig={version:1;remotes:Remote[]};
type Tag={version:1;name:string;checkpointId:string;message?:string;createdAt:string};
type NativeBundle={version:1;protocol:"sessions-native";repository:any;state:any;refs:any[];checkpoints:any[];manifests:any[];objects:Array<{objectId:string;digest:string;size:number;contentBase64:string}>;sourceDigest?:string};
const internal=(root:string)=>join(root,".sessions");
const readJson=async<T>(p:string):Promise<T>=>JSON.parse(await readFile(p,"utf8"));
const writeJson=async(p:string,v:unknown)=>{await mkdir(dirname(p),{recursive:true});await writeFile(p,JSON.stringify(v,null,2)+"\n","utf8")};
const remoteFile=(root:string)=>join(internal(root),"remotes.json");
const tagDir=(root:string)=>join(internal(root),"refs","tags");
const stateFile=(root:string)=>join(internal(root),"state.json");
const checkpointDir=(root:string)=>join(internal(root),"checkpoints");
const workstreamDir=(root:string)=>join(internal(root),"refs","workstreams");
const manifestDir=(root:string)=>join(internal(root),"objects","manifests");
const objectFile=(root:string,objectId:string)=>{const hash=objectId.replace(/^obj_/,"");return join(internal(root),"objects","blobs",hash.slice(0,2),hash.slice(2))};
async function config(root:string):Promise<RemoteConfig>{try{return await readJson(remoteFile(root))}catch{return{version:1,remotes:[]}}}
export async function listRemotes(root:string){return(await config(root)).remotes}
export async function setRemote(root:string,name:string,url:string){await openRepository(root);const c=await config(root);const next={version:1 as const,remotes:[...c.remotes.filter(r=>r.name!==name),{name,url:url.replace(/\/$/,"")}]};await writeJson(remoteFile(root),next);return next.remotes.find(r=>r.name===name)!}
export async function removeRemote(root:string,name:string){const c=await config(root);await writeJson(remoteFile(root),{version:1,remotes:c.remotes.filter(r=>r.name!==name)})}
async function remote(root:string,name:string){const r=(await listRemotes(root)).find(x=>x.name===name);if(!r)throw new Error(`Unknown remote: ${name}`);return r}
function isHosted(url:string){return /^https?:\/\//.test(url)}
function hostedToken(){const token=process.env.SESSIONS_API_TOKEN?.trim();if(!token)throw new Error("SESSIONS_API_TOKEN is required for hosted Sessions transport");return token}
async function hostedRequest(url:string,init:RequestInit={}){const headers=new Headers(init.headers);headers.set("authorization",`Bearer ${hostedToken()}`);if(!headers.has("content-type"))headers.set("content-type","application/json");const response=await fetch(url,{...init,headers});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body?.error??`Sessions remote HTTP ${response.status}`);return body}
export async function createNativeBundle(root:string):Promise<NativeBundle>{
  const repository=await openRepository(root);const state=await readJson<any>(stateFile(root));const branches=await listWorkstreams(root);const checkpoints=await listHistory(root);const tags=await listTags(root);
  const manifestIds=[...new Set(checkpoints.map(c=>c.sourceManifestId))];const manifests=await Promise.all(manifestIds.map(id=>getSourceManifest(root,id)));
  const objectEntries=new Map<string,{objectId:string;digest:string;size:number}>();for(const manifest of manifests)for(const entry of manifest.entries)objectEntries.set(entry.objectId,{objectId:entry.objectId,digest:entry.digest,size:entry.size});
  const objects=[] as NativeBundle["objects"];for(const object of objectEntries.values()){const content=await readFile(objectFile(root,object.objectId));objects.push({...object,contentBase64:content.toString("base64")});}
  const refs=[...branches.map(b=>({refType:"branch",name:b.name,checkpointId:b.headCheckpointId??null,metadata:{id:b.id,objective:b.objective,createdAt:b.createdAt,updatedAt:b.updatedAt}})),...tags.map(t=>({refType:"tag",name:t.name,checkpointId:t.checkpointId,metadata:{message:t.message,createdAt:t.createdAt}}))];
  return{version:1,protocol:"sessions-native",repository,state:{repository,state,branches,tags},refs,checkpoints,manifests,objects,sourceDigest:checkpoints[0]?.sourceDigest};
}
async function applyNativeBundle(root:string,bundle:NativeBundle){
  if(bundle.protocol!=="sessions-native"||bundle.version!==1)throw new Error("Unsupported Sessions repository protocol");
  const base=internal(root);await rm(base,{recursive:true,force:true});for(const p of [workstreamDir(root),checkpointDir(root),tagDir(root),manifestDir(root),join(base,"objects","blobs")])await mkdir(p,{recursive:true});
  const repository=bundle.state?.repository??bundle.repository;const state=bundle.state?.state??bundle.state;await writeJson(join(base,"repository.json"),repository);await writeJson(stateFile(root),state);
  for(const branch of bundle.state?.branches??[])await writeJson(join(workstreamDir(root),`${branch.id}.json`),branch);
  for(const tag of bundle.state?.tags??[])await writeJson(join(tagDir(root),`${encodeURIComponent(tag.name)}.json`),tag);
  for(const checkpoint of bundle.checkpoints??[])await writeJson(join(checkpointDir(root),`${checkpoint.id}.json`),checkpoint);
  for(const manifest of bundle.manifests??[])await writeJson(join(manifestDir(root),`${manifest.id}.json`),manifest);
  for(const object of bundle.objects??[]){const content=Buffer.from(object.contentBase64,"base64");if(content.byteLength!==Number(object.size))throw new Error(`Sessions object size mismatch: ${object.objectId}`);const path=objectFile(root,object.objectId);await mkdir(dirname(path),{recursive:true});await writeFile(path,content);}
  await materializeHead(root);
}
async function materializeHead(root:string){const active=await getActiveWorkstream(root);if(active.headCheckpointId)await restoreCheckpoint(root,active.headCheckpointId)}
export async function cloneRepository(source:string,destination:string){
  const dest=resolve(destination);await mkdir(dest,{recursive:true});
  if(isHosted(source)){const endpoint=source.replace(/\/$/,"");const bundle=await hostedRequest(`${endpoint}/bundle`) as NativeBundle;await applyNativeBundle(dest,bundle);return openRepository(dest);}
  const src=resolve(source);await cp(join(src,".sessions"),join(dest,".sessions"),{recursive:true,force:true});await materializeHead(dest);return openRepository(dest);
}
export async function fetchRemote(root:string,name="origin"){
  const r=await remote(root,name);const url=r.fetch??r.url;
  if(isHosted(url)){const bundle=await hostedRequest(`${url}/bundle`) as NativeBundle;const incoming=join(internal(root),"remotes",name,"bundle.json");await writeJson(incoming,bundle);return{remote:name,fetchedAt:new Date().toISOString(),path:incoming,protocol:"sessions-native"};}
  const source=resolve(url),incoming=join(internal(root),"remotes",name);await rm(incoming,{recursive:true,force:true});await cp(join(source,".sessions"),incoming,{recursive:true,force:true});return{remote:name,fetchedAt:new Date().toISOString(),path:incoming,protocol:"sessions-native-local"};
}
export async function pushRemote(root:string,name="origin"){
  const r=await remote(root,name);const url=r.push??r.url;
  if(isHosted(url)){const bundle=await createNativeBundle(root);await hostedRequest(url,{method:"POST",body:JSON.stringify({id:bundle.repository.id,name:bundle.repository.name,defaultBranchId:bundle.repository.defaultWorkstreamId,sourceDigest:bundle.sourceDigest})});await hostedRequest(`${url}/${url.endsWith(bundle.repository.id)?"bundle":`${bundle.repository.id}/bundle`}`.replace(/\/+/g,"/").replace("https:/","https://").replace("http:/","http://"),{method:"POST",body:JSON.stringify(bundle)});return{remote:name,pushedAt:new Date().toISOString(),protocol:"sessions-native"};}
  const destination=resolve(url);await mkdir(destination,{recursive:true});await cp(join(root,".sessions"),join(destination,".sessions"),{recursive:true,force:true});return{remote:name,pushedAt:new Date().toISOString(),protocol:"sessions-native-local"};
}
export async function pullRemote(root:string,name="origin"){
  const r=await remote(root,name),status=await repositoryStatus(root);if(!status.clean)throw new Error("Cannot pull with local staged or unstaged changes");const savedRemotes=await config(root),url=r.fetch??r.url;
  if(isHosted(url)){const bundle=await hostedRequest(`${url}/bundle`) as NativeBundle;const local=await openRepository(root);if(local.id!==bundle.repository.id)throw new Error("Remote repository identity does not match local Sessions repository");await applyNativeBundle(root,bundle);await writeJson(remoteFile(root),savedRemotes);return{remote:name,pulledAt:new Date().toISOString(),headCheckpointId:(await getActiveWorkstream(root)).headCheckpointId,protocol:"sessions-native"};}
  const source=resolve(url),local=await openRepository(root),upstream=await openRepository(source);if(local.id!==upstream.id)throw new Error("Remote repository identity does not match local Sessions repository");await cp(join(source,".sessions"),join(root,".sessions"),{recursive:true,force:true});await writeJson(remoteFile(root),savedRemotes);await materializeHead(root);return{remote:name,pulledAt:new Date().toISOString(),headCheckpointId:(await getActiveWorkstream(root)).headCheckpointId,protocol:"sessions-native-local"};
}
export async function createTag(root:string,name:string,checkpointRef?:string,message?:string){const active=await getActiveWorkstream(root);const checkpoint=checkpointRef?await getCheckpoint(root,checkpointRef):active.headCheckpointId?await getCheckpoint(root,active.headCheckpointId):undefined;if(!checkpoint)throw new Error("Cannot tag repository without a checkpoint");const p=join(tagDir(root),`${encodeURIComponent(name)}.json`);try{await stat(p);throw new Error(`Tag already exists: ${name}`)}catch(e:any){if(e?.code!=="ENOENT")throw e}const tag:Tag={version:1,name,checkpointId:checkpoint.id,message,createdAt:new Date().toISOString()};await writeJson(p,tag);return tag}
export async function listTags(root:string):Promise<Tag[]>{try{return await Promise.all((await readdir(tagDir(root))).filter(x=>x.endsWith(".json")).map(x=>readJson<Tag>(join(tagDir(root),x))))}catch{return[]}}
export async function deleteTag(root:string,name:string){await rm(join(tagDir(root),`${encodeURIComponent(name)}.json`),{force:true})}
export async function revertCheckpoint(root:string,reference:string,name?:string){const status=await repositoryStatus(root);if(!status.clean)throw new Error("Cannot revert with local staged or unstaged changes");const active=await getActiveWorkstream(root);if(!active.headCheckpointId)throw new Error("Cannot revert without a current checkpoint");const before=await getCheckpoint(root,active.headCheckpointId),target=await getCheckpoint(root,reference);await restoreCheckpoint(root,target.id);await stagePaths(root,["."]);const reverted=await createCheckpoint(root,{friendlyName:name??`Revert ${target.friendlyName}`,objective:`Revert ${before.id} to tree ${target.id}`,allIfNothingStaged:true});return{before,target,reverted}}

// Legacy migration adapter only. Git is not used by Sessions-native repositories, remotes, push, pull, fetch, clone, commits, branches, tags, verification, or recovery.
async function git(cwd:string,args:string[]){return(await execFileAsync("git",args,{cwd,maxBuffer:16*1024*1024})).stdout.trim()}
export async function importGitRepository(source:string,destination?:string){const sourceRoot=resolve(source),root=destination?resolve(destination):sourceRoot;if(destination){await mkdir(dirname(root),{recursive:true});await execFileAsync("git",["clone","--no-hardlinks",sourceRoot,root])}await initializeRepository(root);const branches=(await git(root,["for-each-ref","--format=%(refname:short)","refs/heads/"])).split("\n").filter(Boolean);const original=(await git(root,["branch","--show-current"]))||branches[0]||"main";const commits=(await git(root,["rev-list","--reverse","--topo-order","--all"])).split("\n").filter(Boolean);const checkpointBySha=new Map<string,string>();for(const sha of commits){await git(root,["checkout","--force",sha]);const subject=await git(root,["show","-s","--format=%s",sha]);const author=await git(root,["show","-s","--format=%an <%ae>",sha]);const cp=await createCheckpoint(root,{friendlyName:subject||sha.slice(0,12),objective:`Imported from legacy Git ${sha}`,actorIds:[author],allIfNothingStaged:true});checkpointBySha.set(sha,cp.id)}for(const branch of branches){const sha=await git(root,["rev-parse",branch]),cp=checkpointBySha.get(sha);if(!cp)continue;try{await createWorkstream(root,{name:branch,fromCheckpointId:cp})}catch{}}for(const tag of (await git(root,["tag","--list"])).split("\n").filter(Boolean)){const sha=await git(root,["rev-list","-n","1",tag]),cp=checkpointBySha.get(sha);if(cp)try{await createTag(root,tag,cp,`Imported legacy tag ${tag}`)}catch{}}const target=(await listWorkstreams(root)).find(w=>w.name===original);if(target)await checkoutWorkstream(root,target.id);await git(root,["checkout","--force",original]);return{repository:await openRepository(root),branches:branches.length,commits:commits.length,tags:(await listTags(root)).length,checkpointBySha:Object.fromEntries(checkpointBySha)}}
