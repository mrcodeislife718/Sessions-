-- Ensure lifecycle evidence is reconstructed from the durable event stream even when
-- snapshots/verifications are written through non-HTTP producers.
create or replace function sessions_record_snapshot_event() returns trigger language plpgsql as $$
begin
  insert into session_events(id, session_id, type, occurred_at, actor, payload)
  values (
    'event_snapshot_' || new.id,
    new.session_id,
    'SnapshotCreated',
    new.created_at,
    '{"id":"sessions-system","kind":"service","displayName":"Sessions"}'::jsonb,
    jsonb_build_object('snapshotId', new.id, 'repositoryId', new.repository_id, 'digest', new.digest)
  ) on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists trg_snapshots_lifecycle_event on snapshots;
create trigger trg_snapshots_lifecycle_event after insert on snapshots
for each row execute function sessions_record_snapshot_event();

create or replace function sessions_record_verification_event() returns trigger language plpgsql as $$
begin
  insert into session_events(id, session_id, type, occurred_at, actor, payload)
  values (
    'event_verification_' || new.id,
    new.session_id,
    case when new.status = 'passed' then 'VerificationPassed' else 'VerificationRecorded' end,
    new.finished_at,
    coalesce(new.requested_by, '{"id":"sessions-system","kind":"service","displayName":"Sessions"}'::jsonb),
    jsonb_build_object('verificationId', new.id, 'snapshotId', new.snapshot_id, 'kind', new.kind, 'status', new.status, 'summary', new.summary)
  ) on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists trg_verifications_lifecycle_event on verifications;
create trigger trg_verifications_lifecycle_event after insert on verifications
for each row execute function sessions_record_verification_event();
