begin;

create or replace function sessions_validate_attestation_binding() returns trigger as $$
declare
  artifact_record repository_artifacts%rowtype;
  key_record principal_signing_keys%rowtype;
  statement_digest text;
  statement_commit text;
  statement_repository text;
  statement_release text;
begin
  select * into artifact_record from repository_artifacts where id=new.artifact_id;
  if not found then raise exception 'attestation artifact does not exist' using errcode='23503'; end if;
  if new.signing_key_id is null then raise exception 'attestation signing key is required' using errcode='23514'; end if;
  select * into key_record from principal_signing_keys where id=new.signing_key_id;
  if not found or key_record.status<>'active' then raise exception 'attestation signing key is not active' using errcode='23514'; end if;
  if new.signer_principal_id is distinct from key_record.principal_id then raise exception 'attestation signer does not own signing key' using errcode='23514'; end if;
  if new.signature_algorithm<>key_record.algorithm then raise exception 'attestation algorithm does not match signing key' using errcode='23514'; end if;

  statement_digest:=coalesce(new.statement#>>'{subject,sha256}','');
  statement_commit:=coalesce(new.statement->>'commitId','');
  statement_repository:=coalesce(new.statement->>'repositoryId','');
  statement_release:=coalesce(new.statement->>'releaseId','');
  if statement_digest<>artifact_record.sha256 then raise exception 'attestation subject digest does not match artifact' using errcode='23514'; end if;
  if statement_commit<>artifact_record.commit_id then raise exception 'attestation commit does not match artifact' using errcode='23514'; end if;
  if statement_repository<>artifact_record.repository_id then raise exception 'attestation repository does not match artifact' using errcode='23514'; end if;
  if artifact_record.release_id is not null and statement_release<>artifact_record.release_id::text then raise exception 'attestation release does not match artifact' using errcode='23514'; end if;
  new.public_key_fingerprint:=key_record.fingerprint_sha256;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_sessions_validate_attestation_signer on artifact_attestations;
drop trigger if exists trg_sessions_validate_attestation_binding on artifact_attestations;
create trigger trg_sessions_validate_attestation_binding before insert or update of artifact_id,statement,signer_principal_id,signature_algorithm,signing_key_id on artifact_attestations for each row execute function sessions_validate_attestation_binding();

-- Supply-chain evidence is repository state. Archived or deletion-pending repositories
-- may be read, but new/changed artifacts and attestations are blocked at persistence.
drop trigger if exists trg_sessions_active_repo_artifacts on repository_artifacts;
create trigger trg_sessions_active_repo_artifacts before insert or update or delete on repository_artifacts for each row execute function sessions_require_active_repository_write();

create or replace function sessions_require_active_artifact_repository() returns trigger as $$
declare
  artifact_value uuid;
  repository_value text;
  lifecycle text;
begin
  if tg_op='DELETE' then artifact_value:=old.artifact_id; else artifact_value:=new.artifact_id; end if;
  select a.repository_id into repository_value from repository_artifacts a where a.id=artifact_value;
  if repository_value is null then raise exception 'attestation artifact does not exist' using errcode='23503'; end if;
  select lifecycle_status into lifecycle from hosted_repositories where id=repository_value;
  if lifecycle<>'active' then raise exception 'repository is read-only while lifecycle status is %',lifecycle using errcode='55000'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_sessions_active_repo_attestations on artifact_attestations;
create trigger trg_sessions_active_repo_attestations before insert or update or delete on artifact_attestations for each row execute function sessions_require_active_artifact_repository();

commit;
