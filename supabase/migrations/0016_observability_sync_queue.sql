-- Durable queue and worker lifecycle for the Checkmate adapter.

alter table public.observability_sync_runs
  add column if not exists available_at timestamptz not null default now(),
  add column if not exists attempt_count integer not null default 0,
  add column if not exists max_attempts integer not null default 5,
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by text;

alter table public.observability_sync_runs
  add constraint observability_sync_attempts_check
  check (attempt_count >= 0 and max_attempts between 1 and 20);

create index observability_sync_runs_queue_idx
on public.observability_sync_runs (status, available_at, created_at)
where status in ('queued', 'failed');

create or replace function public.enqueue_observability_sync(
  target_connection_id uuid,
  sync_type_value public.observability_sync_type default 'full'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  run_id uuid;
begin
  if not public.can_manage_observability() then
    raise exception 'Insufficient permission to enqueue observability sync';
  end if;

  if not exists (
    select 1 from public.observability_connections
    where id = target_connection_id
      and status <> 'disabled'
  ) then
    raise exception 'Observability connection is unavailable';
  end if;

  if exists (
    select 1 from public.observability_sync_runs
    where connection_id = target_connection_id
      and sync_type = sync_type_value
      and status in ('queued', 'running')
  ) then
    select id into run_id
    from public.observability_sync_runs
    where connection_id = target_connection_id
      and sync_type = sync_type_value
      and status in ('queued', 'running')
    order by created_at desc
    limit 1;
    return run_id;
  end if;

  insert into public.observability_sync_runs (
    connection_id,
    sync_type,
    status,
    requested_by,
    available_at
  ) values (
    target_connection_id,
    sync_type_value,
    'queued',
    auth.uid(),
    now()
  ) returning id into run_id;

  perform public.write_audit_event(
    'observability.sync.enqueued',
    'observability_sync_run',
    run_id::text,
    null,
    concat('Sync type: ', sync_type_value::text),
    null,
    jsonb_build_object('connectionId', target_connection_id, 'syncType', sync_type_value)
  );

  return run_id;
end;
$$;

revoke all on function public.enqueue_observability_sync(uuid, public.observability_sync_type) from public;
grant execute on function public.enqueue_observability_sync(uuid, public.observability_sync_type) to authenticated;

create or replace function public.claim_observability_sync_runs(
  worker_id_value text,
  batch_size_value integer default 5
)
returns setof public.observability_sync_runs
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;
  if nullif(btrim(worker_id_value), '') is null then raise exception 'Worker id is required'; end if;
  if batch_size_value < 1 or batch_size_value > 25 then raise exception 'Batch size must be between 1 and 25'; end if;

  return query
  with candidates as (
    select id
    from public.observability_sync_runs
    where status in ('queued', 'failed')
      and available_at <= now()
      and attempt_count < max_attempts
      and (locked_at is null or locked_at < now() - interval '10 minutes')
    order by created_at
    for update skip locked
    limit batch_size_value
  )
  update public.observability_sync_runs run
  set status = 'running',
      worker_id = worker_id_value,
      locked_by = worker_id_value,
      locked_at = now(),
      started_at = coalesce(started_at, now()),
      attempt_count = attempt_count + 1,
      error = null
  from candidates
  where run.id = candidates.id
  returning run.*;
end;
$$;

revoke all on function public.claim_observability_sync_runs(text, integer) from public;
grant execute on function public.claim_observability_sync_runs(text, integer) to service_role;

create or replace function public.complete_observability_sync_run(
  target_run_id uuid,
  succeeded_value boolean,
  partial_value boolean default false,
  records_received_value integer default 0,
  records_written_value integer default 0,
  error_count_value integer default 0,
  error_value text default null,
  details_value jsonb default '{}'::jsonb,
  retry_after_seconds integer default 60
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  run_record public.observability_sync_runs%rowtype;
  final_status public.observability_sync_status;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;

  select * into run_record
  from public.observability_sync_runs
  where id = target_run_id
  for update;

  if not found then raise exception 'Observability sync run not found'; end if;
  if run_record.status <> 'running' then raise exception 'Only running sync runs can be completed'; end if;

  if succeeded_value then
    final_status := case when partial_value then 'partial' else 'succeeded' end;
  elsif run_record.attempt_count >= run_record.max_attempts then
    final_status := 'failed';
  else
    final_status := 'failed';
  end if;

  update public.observability_sync_runs
  set status = final_status,
      finished_at = case when succeeded_value or attempt_count >= max_attempts then now() else null end,
      records_received = greatest(records_received_value, 0),
      records_written = greatest(records_written_value, 0),
      error_count = greatest(error_count_value, 0),
      error = nullif(left(btrim(error_value), 4000), ''),
      details = coalesce(details_value, '{}'::jsonb),
      available_at = case
        when succeeded_value or attempt_count >= max_attempts then available_at
        else now() + make_interval(secs => greatest(30, least(retry_after_seconds, 3600)))
      end,
      locked_at = null,
      locked_by = null,
      worker_id = null
  where id = target_run_id;

  update public.observability_connections
  set last_sync_at = case when succeeded_value then now() else last_sync_at end,
      last_error = case when succeeded_value then null else nullif(left(btrim(error_value), 4000), '') end,
      status = case
        when succeeded_value then 'active'
        when run_record.attempt_count >= run_record.max_attempts then 'degraded'
        else status
      end
  where id = run_record.connection_id;
end;
$$;

revoke all on function public.complete_observability_sync_run(uuid, boolean, boolean, integer, integer, integer, text, jsonb, integer) from public;
grant execute on function public.complete_observability_sync_run(uuid, boolean, boolean, integer, integer, integer, text, jsonb, integer) to service_role;

create or replace function public.retry_observability_sync_run(
  target_run_id uuid,
  reason_value text
)
returns void
language plpgsql
security definer
set search_path = public
as $$;
declare
  run_record public.observability_sync_runs%rowtype;
begin
  if not public.can_manage_observability() then
    raise exception 'Insufficient permission to retry observability sync';
  end if;
  if char_length(btrim(reason_value)) < 5 then raise exception 'Retry reason must contain at least 5 characters'; end if;

  select * into run_record
  from public.observability_sync_runs
  where id = target_run_id
  for update;

  if not found then raise exception 'Observability sync run not found'; end if;
  if run_record.status not in ('failed', 'partial', 'cancelled') then
    raise exception 'Sync run cannot be retried in its current state';
  end if;

  update public.observability_sync_runs
  set status = 'queued',
      available_at = now(),
      finished_at = null,
      locked_at = null,
      locked_by = null,
      worker_id = null,
      error = null,
      details = details || jsonb_build_object('manualRetryReason', btrim(reason_value))
  where id = target_run_id;

  perform public.write_audit_event(
    'observability.sync.retried',
    'observability_sync_run',
    target_run_id::text,
    null,
    btrim(reason_value),
    jsonb_build_object('status', run_record.status),
    jsonb_build_object('status', 'queued')
  );
end;
$$;

revoke all on function public.retry_observability_sync_run(uuid, text) from public;
grant execute on function public.retry_observability_sync_run(uuid, text) to authenticated;

create or replace function public.requeue_stale_observability_sync_runs(
  stale_after_seconds integer default 600
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  if stale_after_seconds < 60 or stale_after_seconds > 86400 then raise exception 'Invalid stale timeout'; end if;

  update public.observability_sync_runs
  set status = 'failed',
      available_at = now() + interval '60 seconds',
      locked_at = null,
      locked_by = null,
      worker_id = null,
      error = 'Worker lease expired'
  where status = 'running'
    and locked_at < now() - make_interval(secs => stale_after_seconds);

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.requeue_stale_observability_sync_runs(integer) from public;
grant execute on function public.requeue_stale_observability_sync_runs(integer) to service_role;
