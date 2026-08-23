import { ActionRunClient } from "./ActionRunClient";
export default async function ActionRunPage({params}:{params:Promise<{id:string;runId:string}>}){const{id,runId}=await params;return <ActionRunClient id={id} runId={runId}/>;}
