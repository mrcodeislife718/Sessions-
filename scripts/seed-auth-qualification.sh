#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

token_a="qualification-token-a"
token_b="qualification-token-b"
token_readonly="qualification-token-readonly"
hash_a="$(printf '%s' "$token_a" | sha256sum | awk '{print $1}')"
hash_b="$(printf '%s' "$token_b" | sha256sum | awk '{print $1}')"
hash_readonly="$(printf '%s' "$token_readonly" | sha256sum | awk '{print $1}')"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v hash_a="$hash_a" -v hash_b="$hash_b" -v hash_readonly="$hash_readonly" <<'SQL'
insert into organizations (id,name) values ('org_a','Tenant A'),('org_b','Tenant B') on conflict (id) do nothing;
insert into workspaces (id,organization_id,name) values ('workspace_a','org_a','Tenant A'),('workspace_b','org_b','Tenant B') on conflict (id) do nothing;
insert into principals (id,kind,display_name) values ('principal_a','human','Tenant A Owner'),('principal_b','human','Tenant B Owner'),('principal_readonly','service','Readonly Client') on conflict (id) do nothing;
insert into workspace_memberships (workspace_id,principal_id,role) values ('workspace_a','principal_a','owner'),('workspace_b','principal_b','owner'),('workspace_a','principal_readonly','viewer') on conflict do nothing;
insert into api_credentials (id,workspace_id,principal_id,token_hash,scopes) values
 ('credential_a','workspace_a','principal_a',:'hash_a',array['sessions:read','sessions:write','sessions:verify','sessions:rollback','metrics:read']),
 ('credential_b','workspace_b','principal_b',:'hash_b',array['sessions:read','sessions:write']),
 ('credential_readonly','workspace_a','principal_readonly',:'hash_readonly',array['sessions:read'])
on conflict (id) do update set token_hash=excluded.token_hash, scopes=excluded.scopes, status='active';
insert into hosted_repositories (id,workspace_id,name) values ('repo_a','workspace_a','repo-a'),('repo_b','workspace_b','repo-b') on conflict (id) do nothing;
insert into sessions (id,workspace_id,project_id,repository_id,objective) values
 ('session_a','workspace_a','project_a','repo_a','tenant a private objective'),
 ('session_b','workspace_b','project_b','repo_b','tenant b private objective')
on conflict (id) do nothing;
SQL

printf '%s\n' "TOKEN_A=$token_a" "TOKEN_B=$token_b" "TOKEN_READONLY=$token_readonly"
