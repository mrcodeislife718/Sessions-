import { NewIssueClient } from "./NewIssueClient";
export default async function NewIssuePage({params}:{params:Promise<{id:string}>}){const {id}=await params;return <NewIssueClient id={id}/>;}
