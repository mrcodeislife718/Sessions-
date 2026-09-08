begin;

create table if not exists principal_signing_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references workspaces(id) on delete cascade,
  principal_id text not null references principals(id) on delete cascade,
  algorithm text not null check (algorithm in ('ed25519')),
  public_key_pem text not null,
  fingerprint_sha256 text not null check (fingerprint_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'active' check (status in ('active','revoked')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique(workspace_id,fingerprint_sha256)
);
create index if not exists principal_signing_keys_principal_idx on principal_signing_keys(workspace_id,principal_id,status);

alter table artifact_attestations add column if not exists signing_key_id uuid references principal_signing_keys(id) on delete restrict;

create or replace function sessions_validate_attestation_signer() returns trigger as $$
declare
  key_record principal_signing_keys%rowtype;
begin
  if new.signing_key_id is null then raise exception 'attestation signing key is required' using errcode='23514'; end if;
  select * into key_record from principal_signing_keys where id=new.signing_key_id;
  if not found or key_record.status<>'active' then raise exception 'attestation signing key is not active' using errcode='23514'; end if;
  if new.signer_principal_id is distinct from key_record.principal_id then raise exception 'attestation signer does not own signing key' using errcode='23514'; end if;
  if new.signature_algorithm<>key_record.algorithm then raise exception 'attestation algorithm does not match signing key' using errcode='23514'; end if;
  new.public_key_fingerprint:=key_record.fingerprint_sha256;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_sessions_validate_attestation_signer on artifact_attestations;
create trigger trg_sessions_validate_attestation_signer before insert or update of signer_principal_id,signature_algorithm,signing_key_id on artifact_attestations for each row execute function sessions_validate_attestation_signer();

commit;
