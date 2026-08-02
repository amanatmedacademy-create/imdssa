-- Worker reliability corrections: non-retryable failures and stale lease recovery.

create or replace function public.complete_product_command(
  target_command_id uuid,
  succeeded boolean,
  response_value jsonb default null,
  error_value text default null,
  external_tenant_id_value text default null,
  retryable_value boolean default true
)
returns public.product_command_status
language plpgsql
security definer
set search_path = public
as $$
declare
  command_record public.product_commands%rowtype;
  next_status public.product_command_status;
  retry_delay_seconds integer;
begin
  select * into command_record
  from public.product_commands
  where id = target_command_id
  for update;
  if not found then raise exception 'Product command not found'; end if;
  if command_record.status <> 'processing' then
    raise exception 'Product command is not processing';
  end if;

  if succeeded then
    next_status := 'succeeded';

    if command_record.command = 'provision_tenant' then
      update public.licenses
      set status = 'active',
          external_tenant_id = coalesce(nullif(btrim(external_tenant_id_value), ''), external_tenant_id),
          activated_at = coalesce(activated_at, now()),
          suspended_at = null,
          revoked_at = null
      where id = command_record.license_id;
    elsif command_record.command = 'resume_tenant' then
      update public.licenses
      set status = 'active', suspended_at = null
      where id = command_record.license_id;
    elsif command_record.command = 'suspend_tenant' then
      update public.licenses
      set status = 'suspended', suspended_at = coalesce(suspended_at, now())
      where id = command_record.license_id;
    elsif command_record.command = 'revoke_tenant' then
      update public.licenses
      set status = 'revoked', revoked_at = coalesce(revoked_at, now())
      where id = command_record.license_id;
    end if;

    update public.product_commands
    set status = next_status,
        response = response_value,
        completed_at = now(),
        locked_at = null,
        locked_by = null,
        last_error = null
    where id = target_command_id;

    update public.workflow_runs
    set status = 'completed',
        output = response_value,
        finished_at = now(),
        locked_at = null,
        locked_by = null
    where id = command_record.workflow_run_id;
  else
    if retryable_value and command_record.attempts < command_record.max_attempts then
      next_status := 'queued';
      retry_delay_seconds := least(900, (power(2, command_record.attempts)::integer * 15));

      update public.product_commands
      set status = next_status,
          response = response_value,
          available_at = now() + make_interval(secs => retry_delay_seconds),
          locked_at = null,
          locked_by = null,
          last_error = nullif(btrim(error_value), '')
      where id = target_command_id;

      update public.workflow_runs
      set status = 'queued',
          attempts = command_record.attempts,
          scheduled_at = now() + make_interval(secs => retry_delay_seconds),
          error = nullif(btrim(error_value), ''),
          locked_at = null,
          locked_by = null
      where id = command_record.workflow_run_id;
    else
      next_status := 'dead_letter';

      update public.product_commands
      set status = next_status,
          response = response_value,
          completed_at = now(),
          locked_at = null,
          locked_by = null,
          last_error = nullif(btrim(error_value), '')
      where id = target_command_id;

      update public.workflow_runs
      set status = 'failed',
          attempts = command_record.attempts,
          error = nullif(btrim(error_value), ''),
          finished_at = now(),
          locked_at = null,
          locked_by = null
      where id = command_record.workflow_run_id;
    end if;
  end if;

  insert into public.workflow_events (
    workflow_run_id, product_command_id, event_type,
    from_status, to_status, message, metadata
  ) values (
    command_record.workflow_run_id,
    target_command_id,
    case when succeeded then 'command.succeeded' else 'command.failed' end,
    command_record.status::text,
    next_status::text,
    nullif(btrim(error_value), ''),
    jsonb_build_object(
      'attempt', command_record.attempts,
      'retryable', retryable_value,
      'response', response_value
    )
  );

  return next_status;
end;
$$;

revoke all on function public.complete_product_command(uuid, boolean, jsonb, text, text) from public;
revoke all on function public.complete_product_command(uuid, boolean, jsonb, text, text, boolean) from public;
grant execute on function public.complete_product_command(uuid, boolean, jsonb, text, text, boolean) to service_role;

create or replace function public.requeue_stale_product_commands(
  stale_after_seconds integer default 300
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  requeued_count integer;
begin
  if stale_after_seconds < 60 or stale_after_seconds > 3600 then
    raise exception 'Stale lease threshold must be between 60 and 3600 seconds';
  end if;

  with stale as (
    update public.product_commands
    set status = case when attempts < max_attempts then 'queued' else 'dead_letter' end,
        available_at = case when attempts < max_attempts then now() else available_at end,
        completed_at = case when attempts < max_attempts then null else now() end,
        locked_at = null,
        locked_by = null,
        last_error = concat('Worker lease expired after ', stale_after_seconds, ' seconds')
    where status = 'processing'
      and locked_at < now() - make_interval(secs => stale_after_seconds)
    returning id, workflow_run_id, status
  )
  select count(*) into requeued_count from stale;

  update public.workflow_runs run
  set status = case
        when command.status = 'queued' then 'queued'
        else 'failed'
      end,
      scheduled_at = case when command.status = 'queued' then now() else run.scheduled_at end,
      finished_at = case when command.status = 'dead_letter' then now() else null end,
      locked_at = null,
      locked_by = null,
      error = concat('Worker lease expired after ', stale_after_seconds, ' seconds')
  from public.product_commands command
  where command.workflow_run_id = run.id
    and command.last_error = concat('Worker lease expired after ', stale_after_seconds, ' seconds');

  insert into public.workflow_events (
    workflow_run_id,
    product_command_id,
    event_type,
    from_status,
    to_status,
    message
  )
  select
    command.workflow_run_id,
    command.id,
    'command.lease_expired',
    'processing',
    command.status::text,
    command.last_error
  from public.product_commands command
  where command.last_error = concat('Worker lease expired after ', stale_after_seconds, ' seconds')
    and command.updated_at >= now() - interval '5 seconds';

  return requeued_count;
end;
$$;

revoke all on function public.requeue_stale_product_commands(integer) from public;
grant execute on function public.requeue_stale_product_commands(integer) to service_role;

comment on function public.requeue_stale_product_commands(integer) is
  'Releases commands abandoned by crashed workers and moves exhausted commands to dead-letter.';
