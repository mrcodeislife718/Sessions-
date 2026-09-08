import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { handleSupplyChain, SupplyChainError } from "./supply-chain.js";

function canonical(value:unknown):string{if(value===null||typeof value!=="object")return JSON.stringify(value);if(Array.isArray(value))return `[${value.map(canonical).join(",")}]`;const object=value as Record<string,unknown>;return `{${Object.keys(object).sort().map(k=>`${JSON.stringify(k)}:${canonical(object[k])}`).join(",")}}`}
function result(rows:any[]){return {rows,rowCount:rows.length}}

function context(signature:string,publicKeyPem:string,statement:Record<string,unknown>,lifecycle="active"){
  let inserted=false;
  const artifact={id:"artifact_test",workspace_id:"workspace_test",repository_id:"repo_test",commit_id:"cp_test",sha256:"b".repeat(64),release_id:null};
  const pool:any={query:async(sql:string)=>{
    if(sql.startsWith("select id,lifecycle_status from hosted_repositories"))return result([{id:"repo_test",lifecycle_status:lifecycle}]);
    if(sql.startsWith("select * from repository_artifacts"))return result([artifact]);
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

function signed(statement:Record<string,unknown>){const {publicKey,privateKey}=generateKeyPairSync("ed25519");const publicKeyPem=publicKey.export({type:"spki",format:"pem"}).toString();const signature=sign(null,Buffer.from(canonical(statement)),privateKey).toString("base64");return {publicKeyPem,signature}}

test("artifact attestation accepts a valid Ed25519 signature bound to artifact repository and commit",async()=>{
  const statement={subject:{sha256:"b".repeat(64)},repositoryId:"repo_test",commitId:"cp_test",builder:{id:"sessions-actions"},buildType:"sessions/native"};
  const key=signed(statement);const c=context(key.signature,key.publicKeyPem,statement);
  assert.equal(await handleSupplyChain(c.value),true);
  assert.equal(c.inserted(),true);
  assert.equal(c.response().status,201);
});

test("artifact attestation rejects a signature that does not match the statement",async()=>{
  const statement={subject:{sha256:"b".repeat(64)},repositoryId:"repo_test",commitId:"cp_test",builder:{id:"sessions-actions"}};
  const {publicKey,privateKey}=generateKeyPairSync("ed25519");const publicKeyPem=publicKey.export({type:"spki",format:"pem"}).toString();const signature=sign(null,Buffer.from(canonical({...statement,tampered:true})),privateKey).toString("base64");const c=context(signature,publicKeyPem,statement);
  await assert.rejects(()=>handleSupplyChain(c.value),(error:unknown)=>error instanceof SupplyChainError&&error.status===400&&error.message.includes("signature verification failed"));
  assert.equal(c.inserted(),false);
});

test("artifact attestation rejects a cryptographically valid statement for the wrong digest",async()=>{
  const statement={subject:{sha256:"c".repeat(64)},repositoryId:"repo_test",commitId:"cp_test",builder:{id:"sessions-actions"}};const key=signed(statement);const c=context(key.signature,key.publicKeyPem,statement);
  await assert.rejects(()=>handleSupplyChain(c.value),(error:unknown)=>error instanceof SupplyChainError&&error.message.includes("subject digest does not match artifact"));
  assert.equal(c.inserted(),false);
});

test("artifact attestation rejects a cryptographically valid statement for the wrong commit or repository",async()=>{
  const statement={subject:{sha256:"b".repeat(64)},repositoryId:"repo_other",commitId:"cp_other",builder:{id:"sessions-actions"}};const key=signed(statement);const c=context(key.signature,key.publicKeyPem,statement);
  await assert.rejects(()=>handleSupplyChain(c.value),(error:unknown)=>error instanceof SupplyChainError&&error.status===400);
  assert.equal(c.inserted(),false);
});

test("archived repository rejects new attestations even with a valid signature",async()=>{
  const statement={subject:{sha256:"b".repeat(64)},repositoryId:"repo_test",commitId:"cp_test",builder:{id:"sessions-actions"}};const key=signed(statement);const c=context(key.signature,key.publicKeyPem,statement,"archived");
  await assert.rejects(()=>handleSupplyChain(c.value),(error:unknown)=>error instanceof SupplyChainError&&error.status===409&&error.message.includes("read-only"));
  assert.equal(c.inserted(),false);
});
