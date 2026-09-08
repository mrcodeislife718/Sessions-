import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { handleSupplyChain, SupplyChainError } from "./supply-chain.js";

function canonical(value:unknown):string{if(value===null||typeof value!=="object")return JSON.stringify(value);if(Array.isArray(value))return `[${value.map(canonical).join(",")}]`;const object=value as Record<string,unknown>;return `{${Object.keys(object).sort().map(k=>`${JSON.stringify(k)}:${canonical(object[k])}`).join(",")}}`}
function result(rows:any[]){return {rows,rowCount:rows.length}}

function context(signature:string,publicKeyPem:string,statement:Record<string,unknown>){
  let inserted=false;
  const pool:any={query:async(sql:string)=>{
    if(sql.startsWith("select id from hosted_repositories"))return result([{id:"repo_test"}]);
    if(sql.startsWith("select * from repository_artifacts"))return result([{id:"artifact_test",workspace_id:"workspace_test",repository_id:"repo_test",commit_id:"cp_test"}]);
    if(sql.startsWith("select status from workspace_entitlements"))return result([{status:"active"}]);
    if(sql.startsWith("select * from principal_signing_keys"))return result([{id:"key_test",workspace_id:"workspace_test",principal_id:"principal_test",status:"active",algorithm:"ed25519",public_key_pem:publicKeyPem,fingerprint_sha256:"a".repeat(64)}]);
    if(sql.startsWith("insert into artifact_attestations")){inserted=true;return result([{id:"attestation_test",artifact_id:"artifact_test",predicate_type:"https://sessions.dev/attestation/build/v1"}])}
    throw new Error(`unexpected query: ${sql}`);
  }};
  let response:any;
  return {
    inserted:()=>inserted,
    response:()=>response,
    value:{pool,identity:{workspaceId:"workspace_test",principalId:"principal_test",scopes:["sessions:write"]},req:{method:"POST"},url:new URL("https://sessions.test/api/repositories/repo_test/artifacts/artifact_test/attestations"),body:async()=>({predicateType:"https://sessions.dev/attestation/build/v1",signingKeyId:"key_test",signature,statement}),send:(status:number,body:unknown)=>{response={status,body}}} as any
  };
}

test("artifact attestation accepts a valid Ed25519 signature over canonical statement",async()=>{
  const {publicKey,privateKey}=generateKeyPairSync("ed25519");
  const publicKeyPem=publicKey.export({type:"spki",format:"pem"}).toString();
  const statement={subject:{sha256:"b".repeat(64)},builder:{id:"sessions-actions"},buildType:"sessions/native"};
  const signature=sign(null,Buffer.from(canonical(statement)),privateKey).toString("base64");
  const c=context(signature,publicKeyPem,statement);
  assert.equal(await handleSupplyChain(c.value),true);
  assert.equal(c.inserted(),true);
  assert.equal(c.response().status,201);
});

test("artifact attestation rejects a signature that does not match the statement",async()=>{
  const {publicKey,privateKey}=generateKeyPairSync("ed25519");
  const publicKeyPem=publicKey.export({type:"spki",format:"pem"}).toString();
  const statement={subject:{sha256:"c".repeat(64)},builder:{id:"sessions-actions"}};
  const signature=sign(null,Buffer.from(canonical({...statement,tampered:true})),privateKey).toString("base64");
  const c=context(signature,publicKeyPem,statement);
  await assert.rejects(()=>handleSupplyChain(c.value),(error:unknown)=>error instanceof SupplyChainError&&error.status===400&&error.message.includes("signature verification failed"));
  assert.equal(c.inserted(),false);
});
