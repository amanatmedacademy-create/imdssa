-- Final workflow hardening and cleanup.

drop function if exists public.complete_product_command(uuid, boolean, jsonb, text, text);

create or replace function public.requeue_stale_product_commands(
  stale_after_seconds integer default 300
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  stale_command_ids uuid[];
  requeued_count integer;
begin
  if stale_after_seconds < 60 or stale_after_seconds > 3600 then
    raise exception 'Stale lease threshold must be between 60 and 3600 seconds';
  end if;

  select coalesce(array_agg(id), '{}'::uuid[])
    into stale_command_ids
  from public.product_commands
  where status = 'processing'
    and locked_at < now() - make_interval(secs => stale_after_seconds);

  requeued_count := cardinality(stale_command_ids);
  if requeued_count = 0 then return 0; end if;

  update public.product_commands
  set status = case when attempts < max_attempts then 'queued' else 'dead_letter' end,
      available_at = case when attempts < max_attempts then now() else available_at end,
      completed_at = case when attempts < max_attempts then null else now() end,
      locked_at = null,
      locked_by = null,
      last_error = concat('Worker lease expired after ', stale_after_seconds, ' seconds')
  where id = any(stale_command_ids);

  update public.workflow_runs run
  set status = case when command.status = 'queued' then 'queued' else 'failed' end,
      scheduled_at = case when command.status = 'queued' then now() else run.scheduled_at end,
      finished_at = case when command.status = 'dead_letter' then now() else null end,
      locked_at = null,
      locked_by = null,
      error = command.last_error
  from public.product_commands command
  where command.id = any(stale_command_ids)
    and command.workflow_run_id = run.id;

  insert into public.workflow_events (
    workflow_run_id,
    product_command_id,
    event_type,
    from_status,
    to_status,
    message,
    metadata
  )
  select
    command.workflow_run_id,
    command.id,
    'command.lease_expired',
    'processing',
    command.status::text,
    command.last_error,
    jsonb_build_object('attempt', command.attempts, 'worker', command.locked_by)
  from public.product_commands command
  where command.id = any(stale_command_ids);

  return requeued_count;
end;
$$;

revoke all on function public.requeue_stale_product_commands(integer) from public;
grant execute on function public.requeue_stale_product_commands(integer) to service_role;
