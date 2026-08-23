export type ActorKind="human"|"ai_agent"|"ai_system"|"service";
export type Actor={id:string;kind:ActorKind;displayName:string;provider?:string;model?:string};
export type StartSessionInput={workspaceId?:string;projectId?:string;repositoryId:string;objective:string;actor?:Actor};
export type SessionAggregate={session:Record<string,unknown>;events:Array<Record<string,unknown>>;snapshots:Array<Record<string,unknown>>;verifications:Array<Record<string,unknown>>};
export interface SessionsTransport{request<T>(path:string,init?:RequestInit):Promise<T>}
export class FetchTransport implements SessionsTransport{constructor(private readonly baseUrl:string,private readonly apiKey?:string){}async request<T>(path:string,init:RequestInit={}):Promise<T>{const headers=new Headers(init.headers);headers.set("content-type","application/json");if(this.apiKey)headers.set("authorization",`Bearer ${this.apiKey}`);const response=await fetch(`${this.baseUrl.replace(/\/$/,"")}${path}`,{...init,headers});const text=await response.text();if(!response.ok)throw new Error(`Sessions API ${response.status}: ${text}`);return(text?JSON.parse(text):{})as T}}
export class SessionsClient{constructor(private readonly transport:SessionsTransport){}private repo(id:string){return`/api/repositories/${encodeURIComponent(id)}`}
listSessions(){return this.transport.request<Array<Record<string,unknown>>>("/api/sessions")}
startSession(input:StartSessionInput){return this.transport.request<SessionAggregate>("/api/sessions",{method:"POST",body:JSON.stringify(input)})}
getSession(id:string){return this.transport.request<SessionAggregate>(`/api/sessions/${id}`)}
appendEvent(id:string,type:string,payload:Record<string,unknown>={},actor?:Actor){return this.transport.request<Record<string,unknown>>(`/api/sessions/${id}/events`,{method:"POST",body:JSON.stringify({type,payload,actor})})}
createSnapshot(id:string,entries:Array<{path:string;contentHash:string;size:number}>,actor?:Actor){return this.transport.request<Record<string,unknown>>(`/api/sessions/${id}/snapshots`,{method:"POST",body:JSON.stringify({entries,actor})})}
recordVerification(id:string,input:{kind:string;status:string;summary:string;snapshotId?:string;actor?:Actor}){return this.transport.request<Record<string,unknown>>(`/api/sessions/${id}/verifications`,{method:"POST",body:JSON.stringify(input)})}
replay(id:string){return this.transport.request<Record<string,unknown>>(`/api/sessions/${id}/replay`,{method:"POST",body:"{}"})}
rollback(id:string,snapshotId:string,actor?:Actor){return this.transport.request<Record<string,unknown>>(`/api/sessions/${id}/rollback`,{method:"POST",body:JSON.stringify({snapshotId,actor})})}
listIssues(repositoryId:string){return this.transport.request<Array<Record<string,unknown>>>(`${this.repo(repositoryId)}/issues`)}
createIssue(repositoryId:string,input:{title:string;body?:string;labels?:string[]}){return this.transport.request<Record<string,unknown>>(`${this.repo(repositoryId)}/issues`,{method:"POST",body:JSON.stringify(input)})}
commentIssue(repositoryId:string,number:number,body:string){return this.transport.request<Record<string,unknown>>(`${this.repo(repositoryId)}/issues/${number}/comments`,{method:"POST",body:JSON.stringify({body})})}
listPullRequests(repositoryId:string){return this.transport.request<Array<Record<string,unknown>>>(`${this.repo(repositoryId)}/pulls`)}
createPullRequest(repositoryId:string,input:{title:string;body?:string;baseBranch:string;headBranch:string;headCommitId?:string;draft?:boolean;requiredApprovals?:number}){return this.transport.request<Record<string,unknown>>(`${this.repo(repositoryId)}/pulls`,{method:"POST",body:JSON.stringify(input)})}
getPullRequest(repositoryId:string,number:number){return this.transport.request<Record<string,unknown>>(`${this.repo(repositoryId)}/pulls/${number}`)}
reviewPullRequest(repositoryId:string,number:number,state:"commented"|"approved"|"changes_requested"|"dismissed",body=""){return this.transport.request<Record<string,unknown>>(`${this.repo(repositoryId)}/pulls/${number}/reviews`,{method:"POST",body:JSON.stringify({state,body})})}
mergePullRequest(repositoryId:string,number:number,mergeCommitId?:string){return this.transport.request<Record<string,unknown>>(`${this.repo(repositoryId)}/pulls/${number}/merge`,{method:"POST",body:JSON.stringify({mergeCommitId})})}
listActions(repositoryId:string){return this.transport.request<Array<Record<string,unknown>>>(`${this.repo(repositoryId)}/actions`)}
createAction(repositoryId:string,input:{trigger:string;commitId?:string;pullRequestId?:string;checks?:Array<{name:string;category:string}>}){return this.transport.request<Record<string,unknown>>(`${this.repo(repositoryId)}/actions`,{method:"POST",body:JSON.stringify(input)})}
listReleases(repositoryId:string){return this.transport.request<Array<Record<string,unknown>>>(`${this.repo(repositoryId)}/releases`)}
createRelease(repositoryId:string,input:{tagName:string;commitId:string;name?:string;body?:string;prerelease?:boolean}){return this.transport.request<Record<string,unknown>>(`${this.repo(repositoryId)}/releases`,{method:"POST",body:JSON.stringify(input)})}
listDeployments(repositoryId:string){return this.transport.request<Array<Record<string,unknown>>>(`${this.repo(repositoryId)}/deployments`)}
createDeployment(repositoryId:string,input:{commitId:string;environment:string;releaseId?:string;evidence?:Record<string,unknown>}){return this.transport.request<Record<string,unknown>>(`${this.repo(repositoryId)}/deployments`,{method:"POST",body:JSON.stringify(input)})}}
