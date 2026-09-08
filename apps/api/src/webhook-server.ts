import http from "node:http";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { handleWebhooks, WebhookError } from "./webhooks.js";
import type { RequestIdentity } from "./security.js";

const port=Number(process.env.WEBHOOK_PORT??4500);
const databaseUrl=process.env.DATABASE_URL??"postgresql://sessions:sessions@localhost:5432/sessions";
const maxBody=Number(process.env.SESSIONS_MAX_BODY_BYTES??1_048_576);
const pool=new Pool({connectionString:databaseUrl,max:Number(process.env.SESSIONS_WEBHOOK_DB_POOL_MAX??5)});
class HttpError extends Error{constructor(public status:number,message:string){super(message)}}
function send(res:http.ServerResponse,status:number,body:unknown){res.writeHead(status,{"content-type":"application/json","cache-control":"no-store"});res.end(status===204?undefined:JSON.stringify(body));}
async function body(req:http.IncomingMessage){const chunks:Buffer[]=[];let size=0;for await(const chunk of req){const b=Buffer.from(chunk);size+=b.length;if(size>maxBody)throw new HttpError(413,"request body too large");chunks.push(b);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{throw new HttpError(400,"invalid JSON body")}}
async function authenticate(req:http.IncomingMessage):Promise<RequestIdentity>{const auth=req.headers.authorization;if(!auth?.startsWith("Bearer "))throw new HttpError(401,"bearer token required");const token=createHash("sha256").update(auth.slice(7).trim()).digest("hex");const r=await pool.query("select c.id credential_id,c.workspace_id,c.principal_id,c.scopes,p.kind principal_kind,p.display_name from api_credentials c join principals p on p.id=c.principal_id where c.token_hash=$1 and c.status='active' and p.status='active' and (c.expires_at is null or c.expires_at>now())",[token]);if(!r.rowCount)throw new HttpError(401,"invalid or expired credential");const x=r.rows[0];return{credentialId:x.credential_id,workspaceId:x.workspace_id,principalId:x.principal_id,principalKind:x.principal_kind,displayName:x.display_name,scopes:x.scopes??[]}}
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url??"/",`http://${req.headers.host??"localhost"}`);if(req.method==="GET"&&url.pathname==="/health"){await pool.query("select 1");return send(res,200,{ok:true,service:"sessions-webhooks"})}const identity=await authenticate(req);if(await handleWebhooks({pool,identity,req,url,body:()=>body(req),send:(status,payload)=>send(res,status,payload)}))return;throw new HttpError(404,"not found");}catch(error){const status=error instanceof HttpError?error.status:error instanceof WebhookError?error.status:500;const message=error instanceof Error?error.message:"internal error";return send(res,status,{error:status>=500?"internal error":message})}});
server.listen(port,"0.0.0.0",()=>console.log(JSON.stringify({level:"info",event:"webhooks.started",port})));
async function shutdown(){server.close(async()=>{await pool.end();process.exit(0)});setTimeout(()=>process.exit(1),10_000).unref()}
process.on("SIGTERM",()=>void shutdown());process.on("SIGINT",()=>void shutdown());
