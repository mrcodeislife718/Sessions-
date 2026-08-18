create or replace view workspace_activation_summary as
select
  workspace_id,
  min(occurred_at) filter (where event_name = 'cli_initialized') as first_cli_initialized_at,
  min(occurred_at) filter (where event_name = 'session_started') as first_session_started_at,
  min(occurred_at) filter (where event_name = 'checkpoint_created') as first_checkpoint_created_at,
  min(occurred_at) filter (where event_name = 'recovery_completed') as first_recovery_completed_at,
  min(occurred_at) filter (where event_name = 'hosted_connected') as first_hosted_connected_at,
  min(occurred_at) filter (where event_name = 'subscription_started') as first_subscription_started_at,
  count(*) filter (where event_name = 'session_started') as sessions_started,
  count(*) filter (where event_name = 'recovery_completed') as recoveries_completed,
  max(occurred_at) as last_activity_at
from product_events
group by workspace_id;

create or replace view workspace_weekly_activity as
select
  workspace_id,
  date_trunc('week', occurred_at) as activity_week,
  count(*) as product_events,
  count(distinct session_id) filter (where session_id is not null) as active_sessions,
  count(*) filter (where event_name = 'recovery_completed') as recoveries_completed
from product_events
group by workspace_id, date_trunc('week', occurred_at);

create or replace view recovery_proof_summary as
select
  experiment_kind,
  baseline_kind,
  count(*) as experiments,
  avg(orientation_ms) as mean_orientation_ms,
  percentile_cont(0.5) within group (order by orientation_ms) as median_orientation_ms,
  avg(missing_context_count::numeric) as mean_missing_context_count,
  avg(case when reproduction_success then 1.0 else 0.0 end) as reproduction_success_rate,
  avg(case when continuation_ready then 1.0 else 0.0 end) as continuation_ready_rate,
  avg(reconstruction_accuracy) filter (where reconstruction_accuracy is not null) as mean_reconstruction_accuracy
from recovery_experiments
group by experiment_kind, baseline_kind;

create or replace view paid_workspace_status as
select
  b.workspace_id,
  b.plan_key,
  b.status as billing_status,
  s.status as subscription_status,
  s.seats,
  s.current_period_start,
  s.current_period_end,
  a.last_activity_at,
  a.sessions_started,
  a.recoveries_completed
from billing_accounts b
left join lateral (
  select * from subscriptions s0
  where s0.billing_account_id = b.id
  order by s0.created_at desc
  limit 1
) s on true
left join workspace_activation_summary a on a.workspace_id = b.workspace_id;
