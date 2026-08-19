import { CodeBrowserClient } from "./CodeBrowserClient";
export default async function CodePage({params}:{params:Promise<{id:string}>}){const{id}=await params;return <CodeBrowserClient id={id}/>;}
