begin;

create or replace function sessions_require_active_repository_write() returns trigger as $$
declare
  repository_value text;
  lifecycle text;
  purge_authorized boolean:=coalesce(current_setting('sessions.lifecycle_purge',true),'')='on';
begin
  if purge_authorized then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  if tg_op='DELETE' then repository_value:=old.repository_id; else repository_value:=new.repository_id; end if;
  select lifecycle_status into lifecycle from hosted_repositories where id=repository_value;
  if lifecycle is null then raise exception 'repository does not exist' using errcode='23503'; end if;
  if lifecycle<>'active' then raise exception 'repository is read-only while lifecycle status is %',lifecycle using errcode='55000'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$ language plpgsql;

create or replace function sessions_require_active_artifact_repository() returns trigger as $$
declare
  artifact_value uuid;
  repository_value text;
  lifecycle text;
  purge_authorized boolean:=coalesce(current_setting('sessions.lifecycle_purge',true),'')='on';
begin
  if purge_authorized then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  if tg_op='DELETE' then artifact_value:=old.artifact_id; else artifact_value:=new.artifact_id; end if;
  select a.repository_id into repository_value from repository_artifacts a where a.id=artifact_value;
  if repository_value is null then raise exception 'attestation artifact does not exist' using errcode='23503'; end if;
  select lifecycle_status into lifecycle from hosted_repositories where id=repository_value;
  if lifecycle<>'active' then raise exception 'repository is read-only while lifecycle status is %',lifecycle using errcode='55000'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$ language plpgsql;

commit;
