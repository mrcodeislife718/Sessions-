import { ReleasesClient } from "./ReleasesClient";
export default async function ReleasesPage({params}:{params:Promise<{id:string}>}){const{id}=await params;return <ReleasesClient id={id}/>;}
