begin;

create or replace function sessions_enqueue_native_checkpoint_webhook() returns trigger as $$
declare
  event_id uuid := gen_random_uuid();
  workspace text;
  event_payload jsonb;
begin
  select workspace_id into workspace from hosted_repositories where id=new.repository_id;
  if workspace is null then raise exception 'native checkpoint repository has no workspace'; end if;
  event_payload:=jsonb_build_object(
    'event','checkpoint.insert',
    'repositoryId',new.repository_id,
    'checkpointId',new.checkpoint_id,
    'sourceDigest',new.record->>'sourceDigest',
    'lifecycle',new.record->>'lifecycle',
    'workstreamId',new.record->>'workstreamId',
    'parentCheckpointIds',coalesce(new.record->'parentCheckpointIds','[]'::jsonb),
    'actorIds',coalesce(new.record->'actorIds','[]'::jsonb),
    'createdAt',coalesce(new.record->>'createdAt',new.created_at::text)
  );
  insert into webhook_events(id,workspace_id,repository_id,event_name,aggregate_type,aggregate_id,payload,occurred_at)
  values(event_id,workspace,new.repository_id,'checkpoint.insert','checkpoint',new.checkpoint_id,event_payload,new.created_at);
  insert into webhook_deliveries(webhook_id,event_id)
  select w.id,event_id from repository_webhooks w
  where w.workspace_id=workspace and w.repository_id=new.repository_id and w.active=true
    and ('*'=any(w.events) or 'checkpoint.insert'=any(w.events));
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_sessions_webhook_native_checkpoint on sessions_repository_checkpoints;
create trigger trg_sessions_webhook_native_checkpoint after insert on sessions_repository_checkpoints for each row execute function sessions_enqueue_native_checkpoint_webhook();

create or replace function sessions_enqueue_native_ref_webhook() returns trigger as $$
declare
  event_id uuid := gen_random_uuid();
  workspace text;
  repository_value text;
  ref_type_value text;
  ref_name_value text;
  checkpoint_value text;
  metadata_value jsonb;
  updated_value timestamptz;
  event_name text;
  event_payload jsonb;
begin
  if tg_op='DELETE' then
    repository_value:=old.repository_id; ref_type_value:=old.ref_type; ref_name_value:=old.name; checkpoint_value:=old.checkpoint_id; metadata_value:=old.metadata; updated_value:=old.updated_at;
  else
    repository_value:=new.repository_id; ref_type_value:=new.ref_type; ref_name_value:=new.name; checkpoint_value:=new.checkpoint_id; metadata_value:=new.metadata; updated_value:=new.updated_at;
  end if;
  select workspace_id into workspace from hosted_repositories where id=repository_value;
  if workspace is null then raise exception 'native ref repository has no workspace'; end if;
  event_name:=ref_type_value || '.' || lower(tg_op);
  event_payload:=jsonb_build_object(
    'event',event_name,
    'repositoryId',repository_value,
    'refType',ref_type_value,
    'name',ref_name_value,
    'checkpointId',checkpoint_value,
    'metadata',coalesce(metadata_value,'{}'::jsonb),
    'updatedAt',updated_value
  );
  insert into webhook_events(id,workspace_id,repository_id,event_name,aggregate_type,aggregate_id,payload,occurred_at)
  values(event_id,workspace,repository_value,event_name,ref_type_value,ref_name_value,event_payload,coalesce(updated_value,now()));
  insert into webhook_deliveries(webhook_id,event_id)
  select w.id,event_id from repository_webhooks w
  where w.workspace_id=workspace and w.repository_id=repository_value and w.active=true
    and ('*'=any(w.events) or event_name=any(w.events));
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_sessions_webhook_native_ref on sessions_repository_refs;
create trigger trg_sessions_webhook_native_ref after insert or update or delete on sessions_repository_refs for each row execute function sessions_enqueue_native_ref_webhook();

commit;
