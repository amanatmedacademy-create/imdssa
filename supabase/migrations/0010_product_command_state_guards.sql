-- Command state guards and workflow execution state corrections.

create or replace function public.enqueue_license_command(
  target_license_id uuid,
  command_value public.product_command_type,
  reason_value text,
  payload_value jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  license_record public.licenses%rowtype;
begin
  if not (public.can_manage_operations() or public.can_manage_billing()) then
    raise exception 'Insufficient permission to enqueue product commands';
  end if;
  if length(btrim(coalesce(reason_value, ''))) < 5 then
    raise exception 'Command reason must contain at least 5 characters';
  end if;

  select * into license_record from public.licenses where id = target_license_id;
  if not found then raise exception 'License not found'; end if;

  if command_value = 'provision_tenant' and license_record.status not in ('pending', 'failed') then
    raise exception 'Provision command requires pending or failed license';
  elsif command_value = 'suspend_tenant' and license_record.status <> 'active' then
    raise exception 'Suspend command requires active license';
  elsif command_value = 'resume_tenant' and license_record.status <> 'suspended' then
    raise exception 'Resume command requires suspended license';
  elsif command_value = 'revoke_tenant' and license_record.status = 'revoked' then
    raise exception 'License is already revoked';
  elsif command_value in ('sync_entitlements', 'invite_owner') and license_record.status = 'revoked' then
    raise exception 'Command is not allowed for revoked license';
  end if;

  return public.enqueue_license_command_internal(
    target_license_id,
    command_value,
    btrim(reason_value),
    auth.uid(),
    coalesce(payload_value, '{}'::jsonb),
    null
  );
end;
$$;

revoke all on function public.enqueue_license_command(uuid, public.product_command_type, text, jsonb) from public;
grant execute on function public.enqueue_license_command(uuid, public.product_command_type, text, jsonb) to authenticated;

create or replace function public.claim_product_commands(
  worker_id_value text,
  batch_size_value integer default 10
)
returns setof public.product_commands
language plpgsql
security definer
set search_path = public
as $$
begin
  if worker_id_value is null or length(btrim(worker_id_value)) < 3 then
    raise exception 'Worker id is required';
  end if;
  if batch_size_value < 1 or batch_size_value > 100 then
    raise exception 'Batch size must be between 1 and 100';
  end if;

  return query
  with candidates as (
    select id
    from public.product_commands
    where status = 'queued'
      and available_at <= now()
    order by available_at, created_at
    for update skip locked
    limit batch_size_value
  ), claimed as (
    update public.product_commands command
    set status = 'processing',
        attempts = command.attempts + 1,
        locked_at = now(),
        locked_by = btrim(worker_id_value),
        last_error = null
    from candidates
    where command.id = candidates.id
    returning command.*
  ), workflow_update as (
    update public.workflow_runs run
    set status = 'running',
        attempts = claimed.attempts,
        locked_at = now(),
        locked_by = btrim(worker_id_value),
        current_step = claimed.command::text,
        error = null
    from claimed
    where run.id = claimed.workflow_run_id
    returning run.id
  )
  select claimed.* from claimed;
end;
$$;

revoke all on function public.claim_product_commands(text, integer) from public;
grant execute on function public.claim_product_commands(text, integer) to service_role;

create or replace function public.retry_product_command(
  target_command_id uuid,
  reason_value text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  command_record public.product_commands%rowtype;
  adapter_id_value uuid;
  endpoint_id_value uuid;
begin
  if not public.can_manage_operations() then
    raise exception 'Insufficient permission to retry product commands';
  end if;
  if length(btrim(coalesce(reason_value, ''))) < 5 then
    raise exception 'Retry reason must contain at least 5 characters';
  end if;

  select * into command_record
  from public.product_commands
  where id = target_command_id
  for update;
  if not found then raise exception 'Product command not found'; end if;
  if command_record.status not in ('failed', 'dead_letter', 'cancelled') then
    raise exception 'Only failed, dead-letter or cancelled commands can be retried';
  end if;

  select a.id, e.id into adapter_id_value, endpoint_id_value
  from public.product_adapters a
  join public.product_endpoints e
    on e.adapter_id = a.id
   and e.environment = 'production'
   and e.status = 'active'
  where a.product_id = command_record.product_id
    and a.status in ('active', 'degraded')
  order by case a.status when 'active' then 0 else 1 end
  limit 1;

  if adapter_id_value is null or endpoint_id_value is null then
    raise exception 'Configure an active adapter and production endpoint before retrying';
  end if;

  update public.product_commands
  set status = 'queued',
      adapter_id = adapter_id_value,
      endpoint_id = endpoint_id_value,
      attempts = 0,
      available_at = now(),
      completed_at = null,
      locked_at = null,
      locked_by = null,
      last_error = null
  where id = target_command_id;

  update public.workflow_runs
  set status = 'queued',
      attempts = 0,
      scheduled_at = now(),
      finished_at = null,
      error = null,
      locked_at = null,
      locked_by = null
  where id = command_record.workflow_run_id;

  insert into public.workflow_events (
    workflow_run_id, product_command_id, event_type,
    from_status, to_status, message
  ) values (
    command_record.workflow_run_id,
    target_command_id,
    'command.retried',
    command_record.status::text,
    'queued',
    btrim(reason_value)
  );

  perform public.write_audit_event(
    'product_command.retried', 'product_command', target_command_id::text,
    command_record.organization_id, btrim(reason_value), to_jsonb(command_record),
    (select to_jsonb(c) from public.product_commands c where c.id = target_command_id)
  );
end;
$$;

revoke all on function public.retry_product_command(uuid, text) from public;
grant execute on function public.retry_product_command(uuid, text) to authenticated;
