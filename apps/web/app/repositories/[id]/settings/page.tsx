import { RepositorySettingsClient } from "./RepositorySettingsClient";
export default async function RepositorySettingsPage({params}:{params:Promise<{id:string}>}){const{id}=await params;return <RepositorySettingsClient id={id}/>;}
