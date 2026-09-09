import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Pool } from "pg";

type Identity={workspaceId:string;principalId:string;scopes:string[]};
type Context={pool:Pool;identity:Identity;req:IncomingMessage;url:URL;body:()=>Promise<any>;send:(status:number,body:unknown)=>void};
type Authority={organization_id:string;role:string;kind:string;plan_key:string|null;entitlement_status:string|null};
export class EnterpriseGovernanceError extends Error{constructor(public status:number,message:string){super(message)}}
function hasScope(i:Identity,s:string){return i.scopes.includes("*")||i.scopes.includes(s)}
function scope(i:Identity,s:string){if(!hasScope(i,s)&&!hasScope(i,"sessions:write"))throw new EnterpriseGovernanceError(403,`missing scope: ${s}`)}
async function authority(c:Context):Promise<Authority>{const r=await c.pool.query(`select w.organization_id,m.role,p.kind,e.plan_key,e.status entitlement_status from workspaces w join workspace_memberships m on m.workspace_id=w.id and m.principal_id=$2 join principals p on p.id=m.principal_id left join workspace_entitlements e on e.workspace_id=w.id where w.id=$1`,[c.identity.workspaceId,c.identity.principalId]);const row=r.rows[0];if(!row)throw new EnterpriseGovernanceError(403,"workspace membership required");return row}
async function enterpriseHumanAdmin(c:Context){const row=await authority(c);if(row.kind!=="human"||!["owner","admin"].includes(row.role))throw new EnterpriseGovernanceError(403,"enterprise governance requires a human workspace owner or admin");if(row.entitlement_status!=="active"||row.plan_key!=="enterprise")throw new EnterpriseGovernanceError(402,"enterprise governance requires an active Enterprise entitlement");return row}
function days(value:unknown,label:string,min:number,max=3650){const n=Number(value);if(!Number.isInteger(n)||n<min||n>max)throw new EnterpriseGovernanceError(400,`${label} must be an integer from ${min} to ${max}`);return n}
function iso(value:string|null,label:string){if(!value)return null;const date=new Date(value);if(Number.isNaN(date.getTime()))throw new EnterpriseGovernanceError(400,`${label} must be an ISO-8601 timestamp`);return date.toISOString()}
function canonical(value:unknown):string{if(value===null||typeof value!=="object")return JSON.stringify(value);if(Array.isArray(value))return `[${value.map(canonical).join(",")}]`;const object=value as Record<string,unknown>;return `{${Object.keys(object).sort().map(k=>`${JSON.stringify(k)}:${canonical(object[k])}`).join(",")}}`}
function encodeCursor(row:any){return Buffer.from(JSON.stringify([row.occurred_at,row.id])).toString("base64url")}
function decodeCursor(value:string|null){if(!value)return null;try{const parsed=JSON.parse(Buffer.from(value,"base64url").toString("utf8"));if(!Array.isArray(parsed)||parsed.length!==2||typeof parsed[0]!=="string"||typeof parsed[1]!=="string"||!parsed[0]||!parsed[1])throw new Error();const timestamp=iso(parsed[0],"cursor");if(!timestamp)throw new Error();return[timestamp,parsed[1]] as const}catch{throw new EnterpriseGovernanceError(400,"invalid audit export cursor")}}
async function audit(c:Context,action:string,organizationId:string,metadata:Record<string,unknown>){await c.pool.query("insert into audit_events(id,workspace_id,principal_id,action,resource_type,resource_id,outcome,metadata) values($1,$2,$3,$4,'organization',$5,'allowed',$6)",[`audit_${randomUUID()}`,c.identity.workspaceId,c.identity.principalId,action,organizationId,JSON.stringify(metadata)])}

async function exportAudit(c:Context,admin:Authority){
  const requested=Number(c.url.searchParams.get("limit")??250);if(!Number.isInteger(requested)||requested<1||requested>1000)throw new EnterpriseGovernanceError(400,"limit must be an integer from 1 to 1000");const limit=requested;
  const from=iso(c.url.searchParams.get("from"),"from"),to=iso(c.url.searchParams.get("to"),"to");
  if(from&&to&&new Date(from).getTime()>new Date(to).getTime())throw new EnterpriseGovernanceError(400,"from must not be after to");
  const action=c.url.searchParams.get("action")?.trim()||null,outcome=c.url.searchParams.get("outcome")?.trim()||null;
  if(outcome&&!['allowed','denied','error'].includes(outcome))throw new EnterpriseGovernanceError(400,"outcome must be allowed, denied, or error");
  const cursor=decodeCursor(c.url.searchParams.get("cursor"));
  const values:any[]=[admin.organization_id];const where=["organization_id=$1"];
  const add=(sql:string,value:unknown)=>{values.push(value);where.push(sql.replace("?",`$${values.length}`))};
  if(from)add("occurred_at>=?",from);if(to)add("occurred_at<=?",to);if(action)add("action=?",action);if(outcome)add("outcome=?",outcome);
  if(cursor){values.push(cursor[0],cursor[1]);where.push(`(occurred_at,id)<($${values.length-1}::timestamptz,$${values.length})`)}
  values.push(limit+1);
  const r=await c.pool.query(`select id,workspace_id,principal_id,request_id,action,resource_type,resource_id,outcome,metadata,occurred_at from organization_audit_events where ${where.join(" and ")} order by occurred_at desc,id desc limit $${values.length}`,values);
  const hasMore=r.rows.length>limit,events=r.rows.slice(0,limit),nextCursor=hasMore&&events.length?encodeCursor(events[events.length-1]):null;
  const generatedAt=new Date().toISOString();const manifest={organizationId:admin.organization_id,generatedAt,filters:{from,to,action,outcome},eventCount:events.length,nextCursor};
  const sha256=createHash("sha256").update(canonical({manifest,events})).digest("hex");
  await audit(c,"organization.audit_export",admin.organization_id,{eventCount:events.length,from,to,action,outcome,sha256});
  c.send(200,{manifest:{...manifest,sha256,algorithm:"sha256",canonicalization:"sessions-canonical-json-v1"},events});
}

async function retentionSweep(c:Context,admin:Authority){
  const b=await c.body();if(String(b.confirmOrganizationId??"")!==admin.organization_id)throw new EnterpriseGovernanceError(400,"confirmOrganizationId must exactly match the organization id");
  const policy=(await c.pool.query("select * from organization_retention_policies where organization_id=$1",[admin.organization_id])).rows[0];if(!policy)throw new EnterpriseGovernanceError(409,"configure an organization retention policy before executing retention");if(policy.legal_hold)throw new EnterpriseGovernanceError(409,"retention deletion is blocked by organization legal hold");
  const batch=Number(b.batchSize??1000);if(!Number.isInteger(batch)||batch<1||batch>10000)throw new EnterpriseGovernanceError(400,"batchSize must be an integer from 1 to 10000");
  const client=await c.pool.connect();const deleted={auditEvents:0,productEvents:0,webhookEvents:0,lifecycleEvents:0};
  try{await client.query("begin");
    const auditRows=await client.query(`with doomed as (select a.id from audit_events a join workspaces w on w.id=a.workspace_id where w.organization_id=$1 and a.occurred_at<now()-($2::text||' days')::interval order by a.occurred_at asc limit $3) delete from audit_events a using doomed d where a.id=d.id`,[admin.organization_id,policy.audit_retention_days,batch]);deleted.auditEvents=auditRows.rowCount??0;
    const productRows=await client.query(`with doomed as (select p.id from product_events p join workspaces w on w.id=p.workspace_id where w.organization_id=$1 and p.occurred_at<now()-($2::text||' days')::interval order by p.occurred_at asc limit $3) delete from product_events p using doomed d where p.id=d.id`,[admin.organization_id,policy.product_event_retention_days,batch]);deleted.productEvents=productRows.rowCount??0;
    const webhookRows=await client.query(`with doomed as (select e.id from webhook_events e join workspaces w on w.id=e.workspace_id where w.organization_id=$1 and e.occurred_at<now()-($2::text||' days')::interval order by e.occurred_at asc limit $3) delete from webhook_events e using doomed d where e.id=d.id`,[admin.organization_id,policy.webhook_retention_days,batch]);deleted.webhookEvents=webhookRows.rowCount??0;
    const lifecycleRows=await client.query(`with doomed as (select e.id from repository_lifecycle_events e join workspaces w on w.id=e.workspace_id where w.organization_id=$1 and e.occurred_at<now()-($2::text||' days')::interval order by e.occurred_at asc limit $3) delete from repository_lifecycle_events e using doomed d where e.id=d.id`,[admin.organization_id,policy.lifecycle_retention_days,batch]);deleted.lifecycleEvents=lifecycleRows.rowCount??0;
    await client.query("commit");
  }catch(error){await client.query("rollback");throw error}finally{client.release()}
  await audit(c,"organization.retention_sweep",admin.organization_id,{batchSize:batch,deleted,policy:{auditRetentionDays:policy.audit_retention_days,productEventRetentionDays:policy.product_event_retention_days,webhookRetentionDays:policy.webhook_retention_days,lifecycleRetentionDays:policy.lifecycle_retention_days}});c.send(200,{organizationId:admin.organization_id,legalHold:false,batchSize:batch,deleted});
}

export async function handleEnterpriseGovernance(c:Context):Promise<boolean>{
  if(c.url.pathname==="/api/organization/audit-export"){
    if(c.req.method!=="GET")throw new EnterpriseGovernanceError(405,"method not allowed");scope(c.identity,"sessions:read");const admin=await enterpriseHumanAdmin(c);await exportAudit(c,admin);return true;
  }
  if(c.url.pathname==="/api/organization/retention-sweep"){
    if(c.req.method!=="POST")throw new EnterpriseGovernanceError(405,"method not allowed");scope(c.identity,"sessions:write");const admin=await enterpriseHumanAdmin(c);await retentionSweep(c,admin);return true;
  }
  if(c.url.pathname!=="/api/organization/retention-policy")return false;
  scope(c.identity,c.req.method==="GET"?"sessions:read":"sessions:write");const admin=await enterpriseHumanAdmin(c);
  if(c.req.method==="GET"){const r=await c.pool.query("select * from organization_retention_policies where organization_id=$1",[admin.organization_id]);c.send(200,r.rows[0]??{organizationId:admin.organization_id,configured:false});return true}
  if(c.req.method!=="PUT")throw new EnterpriseGovernanceError(405,"method not allowed");
  const b=await c.body();const auditDays=days(b.auditRetentionDays??365,"auditRetentionDays",30),productDays=days(b.productEventRetentionDays??365,"productEventRetentionDays",30),webhookDays=days(b.webhookRetentionDays??90,"webhookRetentionDays",7),lifecycleDays=days(b.lifecycleRetentionDays??3650,"lifecycleRetentionDays",365);const legalHold=b.legalHold===true,reason=String(b.legalHoldReason??"").trim();if(legalHold&&!reason)throw new EnterpriseGovernanceError(400,"legalHoldReason is required when legalHold is enabled");if(reason.length>2000)throw new EnterpriseGovernanceError(400,"legalHoldReason must be at most 2000 characters");
  const r=await c.pool.query(`insert into organization_retention_policies(organization_id,audit_retention_days,product_event_retention_days,webhook_retention_days,lifecycle_retention_days,legal_hold,legal_hold_reason,created_by,updated_by) values($1,$2,$3,$4,$5,$6,$7,$8,$8) on conflict(organization_id) do update set audit_retention_days=excluded.audit_retention_days,product_event_retention_days=excluded.product_event_retention_days,webhook_retention_days=excluded.webhook_retention_days,lifecycle_retention_days=excluded.lifecycle_retention_days,legal_hold=excluded.legal_hold,legal_hold_reason=excluded.legal_hold_reason,updated_by=excluded.updated_by,updated_at=now() returning *`,[admin.organization_id,auditDays,productDays,webhookDays,lifecycleDays,legalHold,legalHold?reason:null,c.identity.principalId]);
  await audit(c,"organization.retention_policy.update",admin.organization_id,{auditDays,productDays,webhookDays,lifecycleDays,legalHold,legalHoldReason:legalHold?reason:null});c.send(200,r.rows[0]);return true
}
