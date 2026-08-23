import type { IncomingMessage } from "node:http";
import type { Pool } from "pg";
import type { RequestIdentity } from "./security.js";
import { hasScope } from "./security.js";

export class IssueError extends Error { constructor(public status:number,message:string){super(message);} }
type Context={pool:Pool;identity:RequestIdentity;req:IncomingMessage;url:URL;body:()=>Promise<any>;send:(status:number,body:unknown)=>void};
const scope=(i:RequestIdentity,s:string)=>{if(!hasScope(i,s)&&!hasScope(i,"sessions:write"))throw new IssueError(403,`missing scope: ${s}`)};

export async function handleIssues(c:Context):Promise<boolean>{
  const m=c.url.pathname.match(/^\/api\/repositories\/([^/]+)\/issues\/(\d+)(?:\/(comments|state))?$/);
  if(!m)return false;
  const repositoryId=decodeURIComponent(m[1]);const number=Number(m[2]);const action=m[3];
  const repository=await c.pool.query("select id from hosted_repositories where id=$1 and workspace_id=$2",[repositoryId,c.identity.workspaceId]);
  if(!repository.rowCount&&!c.identity.localDevelopment)throw new IssueError(404,"repository not found");
  const issue=(await c.pool.query("select * from repository_issues where workspace_id=$1 and repository_id=$2 and number=$3",[c.identity.workspaceId,repositoryId,number])).rows[0];
  if(!issue)throw new IssueError(404,"issue not found");
  if(c.req.method==="GET"&&!action){scope(c.identity,"sessions:read");const comments=await c.pool.query("select * from issue_comments where issue_id=$1 order by created_at",[issue.id]);const linkedPulls=await c.pool.query("select number,title,state,head_commit_id,merge_commit_id from pull_requests where workspace_id=$1 and repository_id=$2 and (body ilike $3 or title ilike $3) order by created_at desc",[c.identity.workspaceId,repositoryId,`%#${number}%`]);c.send(200,{...issue,comments:comments.rows,linkedPulls:linkedPulls.rows});return true;}
  if(c.req.method==="POST"&&action==="comments"){scope(c.identity,"sessions:write");const b=await c.body();if(!String(b.body??"").trim())throw new IssueError(400,"comment body is required");const r=await c.pool.query("insert into issue_comments(issue_id,author_principal_id,body,provenance) values($1,$2,$3,$4) returning *",[issue.id,c.identity.principalId,String(b.body).trim(),JSON.stringify({principalKind:c.identity.principalKind,source:"sessions-web"})]);c.send(201,r.rows[0]);return true;}
  if(c.req.method==="POST"&&action==="state"){scope(c.identity,"sessions:write");const b=await c.body();if(!["open","closed"].includes(b.state))throw new IssueError(400,"state must be open or closed");const r=await c.pool.query("update repository_issues set state=$1,closed_at=case when $1='closed' then now() else null end,updated_at=now() where id=$2 returning *",[b.state,issue.id]);c.send(200,r.rows[0]);return true;}
  return false;
}
