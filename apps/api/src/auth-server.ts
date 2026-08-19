import http from "node:http";
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { Pool, type PoolClient } from "pg";

const scrypt = promisify(scryptCallback);
const port = Number(process.env.AUTH_PORT ?? 4200);
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://sessions:sessions@localhost:5432/sessions";
const maxBody = Number(process.env.SESSIONS_MAX_BODY_BYTES ?? 1_048_576);
const rateLimit = Number(process.env.SESSIONS_AUTH_RATE_LIMIT ?? 20);
const pool = new Pool({ connectionString: databaseUrl, max: Number(process.env.SESSIONS_AUTH_DB_POOL_MAX ?? 10) });
const attempts = new Map<string, { count: number; resetAt: number }>();

class HttpError extends Error { constructor(public readonly status: number, message: string) { super(message); } }
type PlanKey = "developer"|"team"|"business"|"enterprise";
const planLimits: Record<PlanKey,{repositories:number|null;runnerSeconds:number|null;storageBytes:number|null;retainedEventBytes:number|null}> = {
  developer:{repositories:10,runnerSeconds:10_000,storageBytes:10*1024**3,retainedEventBytes:5*1024**3},
  team:{repositories:100,runnerSeconds:100_000,storageBytes:100*1024**3,retainedEventBytes:50*1024**3},
  business:{repositories:1000,runnerSeconds:1_000_000,storageBytes:1024*1024**3,retainedEventBytes:500*1024**3},
  enterprise:{repositories:null,runnerSeconds:null,storageBytes:null,retainedEventBytes:null},
};

function send(res: http.ServerResponse, status: number, body: unknown) { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); }
async function jsonBody(req: http.IncomingMessage) { const chunks: Buffer[]=[];let size=0;for await(const chunk of req){const buffer=Buffer.from(chunk);size+=buffer.length;if(size>maxBody)throw new HttpError(413,"request body too large");chunks.push(buffer);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{throw new HttpError(400,"invalid JSON body");} }
function clientKey(req: http.IncomingMessage) { return String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "unknown").split(",")[0].trim(); }
function enforceRateLimit(req: http.IncomingMessage) { const key=clientKey(req),now=Date.now(),prior=attempts.get(key),bucket=!prior||prior.resetAt<=now?{count:0,resetAt:now+60_000}:prior;bucket.count+=1;attempts.set(key,bucket);if(bucket.count>rateLimit)throw new HttpError(429,"too many authentication attempts; try again shortly"); }
function normalizeEmail(value: unknown) { return String(value ?? "").trim().toLowerCase(); }
function validatePassword(password: string) { if (password.length < 12 || password.length > 256) throw new HttpError(400, "password must be between 12 and 256 characters"); }
function validatePlan(plan: unknown):PlanKey { const value=String(plan??"developer") as PlanKey;if(!/^(developer|team|business|enterprise)$/.test(value))throw new HttpError(400,"invalid paid plan");return value; }
function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }
async function passwordHash(password: string, salt: string) { return (await scrypt(password, salt, 64) as Buffer).toString("hex"); }
async function verifyPassword(password: string, salt: string, expected: string) { const actual=Buffer.from(await passwordHash(password,salt),"hex"),target=Buffer.from(expected,"hex");return actual.length===target.length&&timingSafeEqual(actual,target); }
function ids() { const id=()=>randomUUID();return{org:`org_${id()}`,workspace:`workspace_${id()}`,principal:`principal_${id()}`,credential:`credential_${id()}`,billing:`billing_${id()}`}; }
function issueToken() { return `sess_${randomBytes(32).toString("hex")}`; }
const ownerScopes=["sessions:read","sessions:write","sessions:verify","sessions:rollback","metrics:read","billing:read","billing:write","account:export"];
async function createCredential(db: PoolClient, workspaceId: string, principalId: string) { const token=issueToken();await db.query("insert into api_credentials(id,workspace_id,principal_id,token_hash,scopes) values($1,$2,$3,$4,$5)",[`credential_${randomUUID()}`,workspaceId,principalId,hashToken(token),ownerScopes]);return token; }

async function signup(body:any) {
  const email=String(body.email??"").trim(),normalized=normalizeEmail(email),password=String(body.password??""),displayName=String(body.displayName??"").trim(),workspaceName=String(body.workspaceName??"").trim(),plan=validatePlan(body.planKey),limits=planLimits[plan];
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))throw new HttpError(400,"valid email is required");if(displayName.length<2||displayName.length>120)throw new HttpError(400,"display name is required");if(workspaceName.length<2||workspaceName.length>120)throw new HttpError(400,"workspace name is required");validatePassword(password);
  const salt=randomBytes(16).toString("hex"),digest=await passwordHash(password,salt),id=ids(),client=await pool.connect();
  try {
    await client.query("begin");
    if((await client.query("select 1 from hosted_auth_accounts where normalized_email=$1",[normalized])).rowCount)throw new HttpError(409,"an account already exists for this email");
    await client.query("insert into organizations(id,name) values($1,$2)",[id.org,workspaceName]);
    await client.query("insert into workspaces(id,organization_id,name) values($1,$2,$3)",[id.workspace,id.org,workspaceName]);
    await client.query("insert into principals(id,kind,display_name,email) values($1,'human',$2,$3)",[id.principal,displayName,email]);
    await client.query("insert into workspace_memberships(workspace_id,principal_id,role) values($1,$2,'owner')",[id.workspace,id.principal]);
    await client.query("insert into hosted_auth_accounts(principal_id,email,normalized_email,password_salt,password_hash) values($1,$2,$3,$4,$5)",[id.principal,email,normalized,salt,digest]);
    await client.query("insert into billing_accounts(id,workspace_id,plan_key,status,billing_email,payment_state) values($1,$2,$3,'pending',$4,'pending')",[id.billing,id.workspace,plan,email]);
    await client.query("insert into workspace_entitlements(workspace_id,plan_key,status,source,reason) values($1,$2,'suspended','internal','awaiting_payment')",[id.workspace,plan]);
    await client.query("insert into workspace_limits(workspace_id,hosted_repository_limit,runner_seconds_monthly_limit,storage_bytes_limit,retained_event_bytes_limit) values($1,$2,$3,$4,$5)",[id.workspace,limits.repositories,limits.runnerSeconds,limits.storageBytes,limits.retainedEventBytes]);
    await client.query("insert into product_events(id,workspace_id,principal_id,event_name,properties) values($1,$2,$3,'self_service_signup',$4)",[`product_${randomUUID()}`,id.workspace,id.principal,JSON.stringify({plan,limits})]);
    const token=await createCredential(client,id.workspace,id.principal);await client.query("commit");
    return{token,workspaceId:id.workspace,principalId:id.principal,planKey:plan,entitlementStatus:"suspended",limits};
  } catch(error:any){await client.query("rollback");if(error?.code==="23505")throw new HttpError(409,"an account already exists for this email");throw error;}finally{client.release();}
}

async function login(body:any) {
  const normalized=normalizeEmail(body.email),password=String(body.password??"");validatePassword(password);
  const result=await pool.query(`select a.*,p.status as principal_status,m.workspace_id from hosted_auth_accounts a join principals p on p.id=a.principal_id join workspace_memberships m on m.principal_id=a.principal_id where a.normalized_email=$1 and m.role in ('owner','admin') order by m.created_at limit 1`,[normalized]);
  if(!result.rowCount)throw new HttpError(401,"invalid email or password");const account=result.rows[0];if(account.principal_status!=="active")throw new HttpError(403,"account is not active");if(account.locked_until&&new Date(account.locked_until).getTime()>Date.now())throw new HttpError(429,"account temporarily locked");
  if(!(await verifyPassword(password,account.password_salt,account.password_hash))){const failures=Number(account.failed_attempts??0)+1;await pool.query("update hosted_auth_accounts set failed_attempts=$2,locked_until=case when $2>=8 then now()+interval '15 minutes' else null end,updated_at=now() where principal_id=$1",[account.principal_id,failures]);throw new HttpError(401,"invalid email or password");}
  const client=await pool.connect();try{await client.query("begin");const token=await createCredential(client,account.workspace_id,account.principal_id);await client.query("update hosted_auth_accounts set failed_attempts=0,locked_until=null,last_login_at=now(),updated_at=now() where principal_id=$1",[account.principal_id]);await client.query("commit");return{token,workspaceId:account.workspace_id,principalId:account.principal_id};}catch(error){await client.query("rollback");throw error;}finally{client.release();}
}

const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url??"/",`http://${req.headers.host??"localhost"}`);if(req.method==="GET"&&url.pathname==="/health"){await pool.query("select 1");return send(res,200,{ok:true,service:"sessions-auth"});}if(req.method==="POST"&&url.pathname==="/api/auth/signup"){enforceRateLimit(req);return send(res,201,await signup(await jsonBody(req)));}if(req.method==="POST"&&url.pathname==="/api/auth/login"){enforceRateLimit(req);return send(res,200,await login(await jsonBody(req)));}throw new HttpError(404,"not found");}catch(error){const status=error instanceof HttpError?error.status:500,message=error instanceof Error?error.message:"internal error";return send(res,status,{error:status>=500?"internal error":message});}});
server.listen(port,"0.0.0.0",()=>console.log(JSON.stringify({level:"info",event:"auth.started",port})));async function shutdown(){server.close(async()=>{await pool.end();process.exit(0);});setTimeout(()=>process.exit(1),10_000).unref();}process.on("SIGTERM",()=>void shutdown());process.on("SIGINT",()=>void shutdown());
