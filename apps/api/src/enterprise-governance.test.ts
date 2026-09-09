import assert from "node:assert/strict";
import test from "node:test";
import { handleEnterpriseGovernance, EnterpriseGovernanceError } from "./enterprise-governance.js";

function result(rows:any[]){return{rows,rowCount:rows.length}}
const authority={organization_id:"org_test",role:"owner",kind:"human",plan_key:"enterprise",entitlement_status:"active"};
function baseContext(method:string,path:string,body:any={},query:Record<string,string>={}){
  const url=new URL(`https://sessions.test${path}`);for(const [key,value] of Object.entries(query))url.searchParams.set(key,value);
  let response:any;
  return{url,response:()=>response,value:{identity:{workspaceId:"workspace_test",principalId:"principal_test",scopes:["sessions:read","sessions:write"]},req:{method},url,body:async()=>body,send:(status:number,payload:unknown)=>{response={status,payload}}} as any};
}

test("enterprise audit export returns deterministic tamper-evident manifest",async()=>{
  const c=baseContext("GET","/api/organization/audit-export",{}, {limit:"2"});
  const rows=[{id:"audit_2",workspace_id:"workspace_test",principal_id:"principal_test",request_id:"req_2",action:"repository.read",resource_type:"repository",resource_id:"repo_test",outcome:"allowed",metadata:{b:2,a:1},occurred_at:"2026-09-09T00:00:02.000Z"},{id:"audit_1",workspace_id:"workspace_test",principal_id:"principal_test",request_id:"req_1",action:"repository.read",resource_type:"repository",resource_id:"repo_test",outcome:"allowed",metadata:{ok:true},occurred_at:"2026-09-09T00:00:01.000Z"}];
  let auditRecorded=false;
  c.value.pool={query:async(sql:string)=>{if(sql.includes("from workspaces w join workspace_memberships"))return result([authority]);if(sql.includes("from organization_audit_events"))return result(rows);if(sql.startsWith("insert into audit_events")){auditRecorded=true;return result([])}throw new Error(`unexpected query: ${sql}`)}};
  assert.equal(await handleEnterpriseGovernance(c.value),true);assert.equal(c.response().status,200);const manifest=c.response().payload.manifest;assert.equal(manifest.eventCount,2);assert.match(manifest.sha256,/^[a-f0-9]{64}$/);assert.equal(manifest.algorithm,"sha256");assert.equal(auditRecorded,true);
});

test("retention policy requires a reason before legal hold can be enabled",async()=>{
  const c=baseContext("PUT","/api/organization/retention-policy",{legalHold:true});
  c.value.pool={query:async(sql:string)=>{if(sql.includes("from workspaces w join workspace_memberships"))return result([authority]);throw new Error(`unexpected query: ${sql}`)}};
  await assert.rejects(()=>handleEnterpriseGovernance(c.value),(error:unknown)=>error instanceof EnterpriseGovernanceError&&error.status===400&&error.message.includes("legalHoldReason"));
});

test("retention sweep refuses destructive retention while legal hold is active",async()=>{
  const c=baseContext("POST","/api/organization/retention-sweep",{confirmOrganizationId:"org_test",batchSize:100});
  c.value.pool={query:async(sql:string)=>{if(sql.includes("from workspaces w join workspace_memberships"))return result([authority]);if(sql.startsWith("select * from organization_retention_policies"))return result([{organization_id:"org_test",legal_hold:true,audit_retention_days:365,product_event_retention_days:365,webhook_retention_days:90,lifecycle_retention_days:3650}]);throw new Error(`unexpected query: ${sql}`)},connect:async()=>{throw new Error("retention must not acquire a destructive transaction under legal hold")}};
  await assert.rejects(()=>handleEnterpriseGovernance(c.value),(error:unknown)=>error instanceof EnterpriseGovernanceError&&error.status===409&&error.message.includes("legal hold"));
});
