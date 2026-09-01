begin;

create index if not exists session_events_task_id_idx
  on session_events ((payload->>'taskId'))
  where payload ? 'taskId';

create index if not exists session_events_logical_worker_id_idx
  on session_events ((payload->>'logicalWorkerId'))
  where payload ? 'logicalWorkerId';

create index if not exists session_events_provider_session_id_idx
  on session_events ((payload->>'providerSessionId'))
  where payload ? 'providerSessionId';

create index if not exists session_events_commit_sha_idx
  on session_events ((payload->>'commitSha'))
  where payload ? 'commitSha';

create index if not exists session_events_worktree_idx
  on session_events ((payload->>'worktree'))
  where payload ? 'worktree';

commit;
