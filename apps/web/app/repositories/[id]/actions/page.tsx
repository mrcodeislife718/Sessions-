import { ActionsClient } from "./ActionsClient";
export default async function ActionsPage({params}:{params:Promise<{id:string}>}){const{id}=await params;return <ActionsClient id={id}/>;}
