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
  row_data record;
  event_name text;
  event_payload jsonb;
begin
  if tg_op='DELETE' then row_data:=old; else row_data:=new; end if;
  select workspace_id into workspace from hosted_repositories where id=row_data.repository_id;
  if workspace is null then raise exception 'native ref repository has no workspace'; end if;
  event_name:=row_data.ref_type || '.' || lower(tg_op);
  event_payload:=jsonb_build_object(
    'event',event_name,
    'repositoryId',row_data.repository_id,
    'refType',row_data.ref_type,
    'name',row_data.name,
    'checkpointId',row_data.checkpoint_id,
    'metadata',coalesce(row_data.metadata,'{}'::jsonb),
    'updatedAt',row_data.updated_at
  );
  insert into webhook_events(id,workspace_id,repository_id,event_name,aggregate_type,aggregate_id,payload,occurred_at)
  values(event_id,workspace,row_data.repository_id,event_name,row_data.ref_type,row_data.name,event_payload,coalesce(row_data.updated_at,now()));
  insert into webhook_deliveries(webhook_id,event_id)
  select w.id,event_id from repository_webhooks w
  where w.workspace_id=workspace and w.repository_id=row_data.repository_id and w.active=true
    and ('*'=any(w.events) or event_name=any(w.events));
  return case when tg_op='DELETE' then old else new end;
end;
$$ language plpgsql;

drop trigger if exists trg_sessions_webhook_native_ref on sessions_repository_refs;
create trigger trg_sessions_webhook_native_ref after insert or update or delete on sessions_repository_refs for each row execute function sessions_enqueue_native_ref_webhook();

commit;
