begin;

create index if not exists session_events_workspace_session_id_idx
  on session_events (workspace_id, session_id, id);

create index if not exists session_events_workspace_session_causation_idx
  on session_events (workspace_id, session_id, causation_id)
  where causation_id is not null;

create index if not exists session_events_workspace_session_occurred_idx
  on session_events (workspace_id, session_id, occurred_at, id);

commit;
