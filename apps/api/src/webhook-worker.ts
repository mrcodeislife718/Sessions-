import { createHmac } from "node:crypto";
import { Pool } from "pg";
import { assertSafeWebhookUrl, decryptWebhookSecret } from "./webhook-crypto.js";

const databaseUrl=process.env.DATABASE_URL??"postgresql://sessions:sessions@localhost:5432/sessions";
const pool=new Pool({connectionString:databaseUrl,max:Number(process.env.SESSIONS_WEBHOOK_DB_POOL_MAX??5)});
const pollMs=Number(process.env.SESSIONS_WEBHOOK_POLL_MS??1500);
const leaseSeconds=Number(process.env.SESSIONS_WEBHOOK_LEASE_SECONDS??60);
const maxAttempts=Number(process.env.SESSIONS_WEBHOOK_MAX_ATTEMPTS??8);
const timeoutMs=Number(process.env.SESSIONS_WEBHOOK_TIMEOUT_MS??10000);
let stopping=false;

type Delivery={delivery_id:string;webhook_id:string;event_id:string;attempt_count:number;endpoint_url:string;secret_ciphertext:string;secret_nonce:string;secret_auth_tag:string;event_name:string;payload:any;occurred_at:string};
async function claim():Promise<Delivery|null>{const client=await pool.connect();try{await client.query("begin");const r=await client.query(`select d.id delivery_id,d.webhook_id,d.event_id,d.attempt_count,w.endpoint_url,w.secret_ciphertext,w.secret_nonce,w.secret_auth_tag,e.event_name,e.payload,e.occurred_at
from webhook_deliveries d join repository_webhooks w on w.id=d.webhook_id join webhook_events e on e.id=d.event_id
where w.active=true and ((d.status in ('pending','failed') and d.next_attempt_at<=now()) or (d.status='leased' and d.lease_expires_at<now()))
order by d.next_attempt_at,d.created_at for update of d skip locked limit 1`);if(!r.rowCount){await client.query("commit");return null;}const row=r.rows[0];await client.query("update webhook_deliveries set status='leased',attempt_count=attempt_count+1,lease_expires_at=now()+($2::text||' seconds')::interval,updated_at=now() where id=$1",[row.delivery_id,leaseSeconds]);await client.query("commit");return{...row,attempt_count:Number(row.attempt_count)+1};}catch(e){await client.query("rollback");throw e;}finally{client.release();}}
function retryDelay(attempt:number){return Math.min(3600,Math.max(5,2**Math.min(10,attempt))*5);}
async function deliver(row:Delivery){const url=await assertSafeWebhookUrl(row.endpoint_url);const body=JSON.stringify({id:row.event_id,event:row.event_name,occurredAt:row.occurred_at,payload:row.payload});const secret=decryptWebhookSecret({ciphertext:row.secret_ciphertext,nonce:row.secret_nonce,authTag:row.secret_auth_tag});const signature=createHmac("sha256",secret).update(body).digest("hex");const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);try{const response=await fetch(url,{method:"POST",headers:{"content-type":"application/json","user-agent":"Sessions-Webhooks/1.0","x-sessions-event":row.event_name,"x-sessions-delivery":row.delivery_id,"x-sessions-signature-256":`sha256=${signature}`},body,signal:controller.signal,redirect:"error"});const excerpt=(await response.text()).slice(0,1024);if(response.ok){await pool.query("update webhook_deliveries set status='succeeded',last_http_status=$2,response_excerpt=$3,last_error=null,delivered_at=now(),lease_expires_at=null,updated_at=now() where id=$1",[row.delivery_id,response.status,excerpt]);return;}throw Object.assign(new Error(`webhook HTTP ${response.status}`),{status:response.status,excerpt});}finally{clearTimeout(timer);}}
async function fail(row:Delivery,error:any){const dead=row.attempt_count>=maxAttempts;const delay=retryDelay(row.attempt_count);await pool.query("update webhook_deliveries set status=$2,last_http_status=$3,last_error=$4,response_excerpt=$5,next_attempt_at=now()+($6::text||' seconds')::interval,lease_expires_at=null,updated_at=now() where id=$1",[row.delivery_id,dead?"dead":"failed",Number.isInteger(error?.status)?error.status:null,String(error?.message??error).slice(0,1024),String(error?.excerpt??"").slice(0,1024),delay]);}
async function loop(){while(!stopping){const row=await claim();if(!row){await new Promise(r=>setTimeout(r,pollMs));continue;}try{await deliver(row);}catch(error){await fail(row,error);}}}
async function shutdown(){stopping=true;await pool.end();}
process.on("SIGTERM",()=>void shutdown());process.on("SIGINT",()=>void shutdown());
loop().catch(async error=>{console.error(JSON.stringify({level:"error",event:"webhook.worker.failed",message:error instanceof Error?error.message:String(error)}));await pool.end();process.exit(1);});
