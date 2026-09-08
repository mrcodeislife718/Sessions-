import { randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Pool } from "pg";
import type { RequestIdentity } from "./security.js";
import { hasScope } from "./security.js";
import { assertSafeWebhookUrl, encryptWebhookSecret } from "./webhook-crypto.js";

export class WebhookError extends Error { constructor(public status: number, message: string) { super(message); } }
type Context = { pool: Pool; identity: RequestIdentity; req: IncomingMessage; url: URL; body: () => Promise<any>; send: (status:number, body:unknown)=>void };
const scope=(i:RequestIdentity,s:string)=>{if(!hasScope(i,s)&&!hasScope(i,"sessions:write"))throw new WebhookError(403,`missing scope: ${s}`)};
async function repository(c:Context,id:string){const r=await c.pool.query("select id from hosted_repositories where id=$1 and workspace_id=$2",[id,c.identity.workspaceId]);if(!r.rowCount&&!c.identity.localDevelopment)throw new WebhookError(404,"repository not found");}

export async function handleWebhooks(c: Context): Promise<boolean> {
  let m=c.url.pathname.match(/^\/api\/repositories\/([^/]+)\/webhooks$/);
  if(m){const repositoryId=decodeURIComponent(m[1]);await repository(c,repositoryId);
    if(c.req.method==="GET"){scope(c.identity,"sessions:read");const r=await c.pool.query("select id,workspace_id,repository_id,endpoint_url,events,active,created_by,created_at,updated_at from repository_webhooks where workspace_id=$1 and repository_id=$2 order by created_at",[c.identity.workspaceId,repositoryId]);c.send(200,r.rows);return true;}
    if(c.req.method==="POST"){scope(c.identity,"sessions:write");const b=await c.body();const endpoint=(await assertSafeWebhookUrl(String(b.endpointUrl??""))).toString();const events=Array.isArray(b.events)&&b.events.length?b.events.map(String):["*"];if(events.length>64||events.some((v:string)=>!/^[a-z_]+\.(insert|update|delete)$|^\*$/.test(v)))throw new WebhookError(400,"invalid webhook event subscription");const secret=typeof b.secret==="string"&&b.secret.length>=32?b.secret:randomBytes(32).toString("base64url");const encrypted=encryptWebhookSecret(secret);const id=randomUUID();try{const r=await c.pool.query("insert into repository_webhooks(id,workspace_id,repository_id,endpoint_url,events,active,secret_ciphertext,secret_nonce,secret_auth_tag,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id,workspace_id,repository_id,endpoint_url,events,active,created_by,created_at,updated_at",[id,c.identity.workspaceId,repositoryId,endpoint,events,b.active!==false,encrypted.ciphertext,encrypted.nonce,encrypted.authTag,c.identity.principalId]);c.send(201,{...r.rows[0],signingSecret:secret});return true;}catch(error:any){if(error?.code==="23505")throw new WebhookError(409,"webhook endpoint already exists for repository");throw error;}}
  }
  m=c.url.pathname.match(/^\/api\/repositories\/([^/]+)\/webhooks\/([^/]+)(?:\/(deliveries|redrive))?$/);
  if(m){const repositoryId=decodeURIComponent(m[1]),webhookId=decodeURIComponent(m[2]),action=m[3];await repository(c,repositoryId);const hook=await c.pool.query("select id from repository_webhooks where id=$1 and workspace_id=$2 and repository_id=$3",[webhookId,c.identity.workspaceId,repositoryId]);if(!hook.rowCount)throw new WebhookError(404,"webhook not found");
    if(c.req.method==="DELETE"&&!action){scope(c.identity,"sessions:write");await c.pool.query("delete from repository_webhooks where id=$1",[webhookId]);c.send(204,{});return true;}
    if(c.req.method==="GET"&&action==="deliveries"){scope(c.identity,"sessions:read");const r=await c.pool.query("select d.id,d.status,d.attempt_count,d.next_attempt_at,d.last_http_status,d.last_error,d.response_excerpt,d.delivered_at,d.created_at,e.event_name,e.aggregate_type,e.aggregate_id,e.occurred_at from webhook_deliveries d join webhook_events e on e.id=d.event_id where d.webhook_id=$1 order by d.created_at desc limit 200",[webhookId]);c.send(200,r.rows);return true;}
    if(c.req.method==="POST"&&action==="redrive"){scope(c.identity,"sessions:write");const b=await c.body();if(!b.deliveryId)throw new WebhookError(400,"deliveryId is required");const r=await c.pool.query("update webhook_deliveries set status='pending',next_attempt_at=now(),lease_expires_at=null,last_error=null,updated_at=now() where id=$1 and webhook_id=$2 and status in ('failed','dead') returning id,status,next_attempt_at",[String(b.deliveryId),webhookId]);if(!r.rowCount)throw new WebhookError(409,"delivery is not eligible for redrive");c.send(202,r.rows[0]);return true;}
  }
  return false;
}
