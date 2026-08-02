-- Workflow and product provisioning orchestrator.
-- Commands are persisted before delivery, claimed with SKIP LOCKED and executed
-- by a trusted backend worker. Product APIs never receive browser credentials.

create type public.product_command_type as enum (
  'provision_tenant',
  'suspend_tenant',
  'resume_tenant',
  'revoke_tenant',
  'sync_entitlements',
  'invite_owner'
);

create type public.product_command_status as enum (
  'queued',
  'processing',
  'succeeded',
  'failed',
  'dead_letter',
  'cancelled'
);

alter table public.workflow_runs
  add column if not exists correlation_id uuid not null default gen_random_uuid(),
  add column if not exists idempotency_key text,
  add column if not exists current_step text,
  add column if not exists attempts integer not null default 0,
  add column if not exists max_attempts integer not null default 5,
  add column if not exists scheduled_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by text;

update public.workflow_runs
set idempotency_key = 'legacy:' || id::text
where idempotency_key is null;

alter table public.workflow_runs alter column idempotency_key set not null;
create unique index if not exists workflow_runs_idempotency_unique on public.workflow_runs(idempotency_key);
create index if not exists workflow_runs_schedule_idx on public.workflow_runs(status, scheduled_at);

create trigger workflow_runs_set_updated_at
before update on public.workflow_runs
for each row execute function public.set_updated_at();

create table public.product_commands (
  id uuid primary key default gen_random_uuid(),
  workflow_run_id uuid not null references public.workflow_runs(id) on delete cascade,
  license_id uuid not null references public.licenses(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  adapter_id uuid references public.product_adapters(id) on delete set null,
  endpoint_id uuid references public.product_endpoints(id) on delete set null,
  command public.product_command_type not null,
  status public.product_command_status not null default 'queued',
  idempotency_key text not null unique,
  correlation_id uuid not null default gen_random_uuid(),
  payload jsonb not null default '{}'::jsonb,
  response jsonb,
  attempts integer not null default 0,
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.workflow_events (
  id uuid primary key default gen_random_uuid(),
  workflow_run_id uuid not null references public.workflow_runs(id) on delete cascade,
  product_command_id uuid references public.product_commands(id) on delete cascade,
  event_type text not null,
  from_status text,
  to_status text,
  message text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index product_commands_claim_idx on public.product_commands(status, available_at, created_at);
create index product_commands_license_idx on public.product_commands(license_id, created_at desc);
create index product_commands_workflow_idx on public.product_commands(workflow_run_id, created_at);
create index workflow_events_run_time_idx on public.workflow_events(workflow_run_id, occurred_at desc);

alter table public.product_commands enable row level security;
alter table public.workflow_events enable row level security;

create trigger product_commands_set_updated_at
before update on public.product_commands
for each row execute function public.set_updated_at();

create policy product_commands_select on public.product_commands
for select to authenticated using (public.is_platform_staff());

create policy workflow_events_select on public.workflow_events
for select to authenticated using (public.is_platform_staff());

create or replace function public.prevent_workflow_event_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Workflow events are append-only';
end;
$$;

revoke all on function public.prevent_workflow_event_mutation() from public;

create trigger workflow_events_immutable
before update or delete on public.workflow_events
for each row execute function public.prevent_workflow_event_mutation();

create or replace function public.enqueue_license_command_internal(
  target_license_id uuid,
  command_value public.product_command_type,
  reason_value text,
  actor_user_id_value uuid default null,
  payload_value jsonb default '{}'::jsonb,
  idempotency_key_value text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  license_record public.licenses%rowtype;
  adapter_record public.product_adapters%rowtype;
  endpoint_record public.product_endpoints%rowtype;
  workflow_id_value uuid;
  command_id_value uuid;
  command_key text;
  initial_command_status public.product_command_status := 'queued';
  initial_error text;
  entitlements_value jsonb;
begin
  select * into license_record
  from public.licenses
  where id = target_license_id;
  if not found then raise exception 'License not found'; end if;

  command_key := coalesce(
    nullif(btrim(idempotency_key_value), ''),
    concat('license:', target_license_id::text, ':', command_value::text, ':tx:', txid_current()::text)
  );

  select id into command_id_value
  from public.product_commands
  where idempotency_key = command_key;
  if command_id_value is not null then return command_id_value; end if;

  select * into adapter_record
  from public.product_adapters
  where product_id = license_record.product_id
    and status in ('active', 'degraded')
  limit 1;

  if found then
    select * into endpoint_record
    from public.product_endpoints
    where adapter_id = adapter_record.id
      and environment = 'production'
      and status in ('active', 'maintenance')
    order by case status when 'active' then 0 else 1 end
    limit 1;
  end if;

  if adapter_record.id is null then
    initial_command_status := 'failed';
    initial_error := 'Product adapter is not configured or active';
  elsif endpoint_record.id is null then
    initial_command_status := 'failed';
    initial_error := 'Production endpoint is not configured or active';
  end if;

  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    into entitlements_value
  from public.entitlements e
  where e.license_id = target_license_id;

  insert into public.workflow_runs (
    organization_id,
    workflow_key,
    status,
    input,
    created_by,
    correlation_id,
    idempotency_key,
    current_step,
    max_attempts,
    scheduled_at
  ) values (
    license_record.organization_id,
    'product.' || command_value::text,
    case when initial_command_status = 'queued' then 'queued' else 'failed' end,
    jsonb_build_object(
      'license_id', target_license_id,
      'product_id', license_record.product_id,
      'reason', reason_value
    ),
    actor_user_id_value,
    gen_random_uuid(),
    command_key,
    command_value::text,
    5,
    now()
  ) returning id into workflow_id_value;

  insert into public.product_commands (
    workflow_run_id,
    license_id,
    organization_id,
    product_id,
    adapter_id,
    endpoint_id,
    command,
    status,
    idempotency_key,
    correlation_id,
    payload,
    max_attempts,
    last_error
  ) values (
    workflow_id_value,
    target_license_id,
    license_record.organization_id,
    license_record.product_id,
    adapter_record.id,
    endpoint_record.id,
    command_value,
    initial_command_status,
    command_key,
    (select correlation_id from public.workflow_runs where id = workflow_id_value),
    coalesce(payload_value, '{}'::jsonb) || jsonb_build_object(
      'organization_id', license_record.organization_id,
      'product_id', license_record.product_id,
      'license_id', target_license_id,
      'external_tenant_id', license_record.external_tenant_id,
      'entitlements', entitlements_value
    ),
    5,
    initial_error
  ) returning id into command_id_value;

  insert into public.workflow_events (
    workflow_run_id, product_command_id, event_type, to_status, message
  ) values (
    workflow_id_value,
    command_id_value,
    'command.enqueued',
    initial_command_status::text,
    coalesce(initial_error, reason_value)
  );

  return command_id_value;
end;
$$;

revoke all on function public.enqueue_license_command_internal(uuid, public.product_command_type, text, uuid, jsonb, text) from public;

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
begin
  if not (public.can_manage_operations() or public.can_manage_billing()) then
    raise exception 'Insufficient permission to enqueue product commands';
  end if;
  if length(btrim(coalesce(reason_value, ''))) < 5 then
    raise exception 'Command reason must contain at least 5 characters';
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

create or replace function public.enqueue_subscription_provisioning(
  target_subscription_id uuid,
  reason_value text default 'Subscription provisioning requested'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  license_record record;
  command_count integer := 0;
begin
  if not (public.can_manage_operations() or public.can_manage_billing()) then
    raise exception 'Insufficient permission to enqueue provisioning';
  end if;

  for license_record in
    select id from public.licenses
    where subscription_id = target_subscription_id
      and status in ('pending', 'failed')
  loop
    perform public.enqueue_license_command_internal(
      license_record.id,
      'provision_tenant',
      reason_value,
      auth.uid(),
      '{}'::jsonb,
      concat('subscription:', target_subscription_id::text, ':license:', license_record.id::text, ':provision:', txid_current()::text)
    );
    command_count := command_count + 1;
  end loop;

  return command_count;
end;
$$;

revoke all on function public.enqueue_subscription_provisioning(uuid, text) from public;
grant execute on function public.enqueue_subscription_provisioning(uuid, text) to authenticated;

create or replace function public.handle_license_command_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  command_value public.product_command_type;
  command_reason text;
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    command_value := 'provision_tenant';
    command_reason := 'License created in pending state';
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status then
    if new.status = 'pending' and new.external_tenant_id is null then
      command_value := 'provision_tenant';
      command_reason := 'License returned to pending state';
    elsif new.status = 'suspended' then
      command_value := 'suspend_tenant';
      command_reason := 'License suspended by subscription lifecycle';
    elsif old.status = 'suspended' and new.status = 'active' then
      command_value := 'resume_tenant';
      command_reason := 'License resumed by subscription lifecycle';
    elsif new.status = 'revoked' then
      command_value := 'revoke_tenant';
      command_reason := 'License revoked by subscription lifecycle';
    end if;
  end if;

  if command_value is not null then
    perform public.enqueue_license_command_internal(
      new.id,
      command_value,
      command_reason,
      auth.uid(),
      '{}'::jsonb,
      concat('license:', new.id::text, ':', command_value::text, ':tx:', txid_current()::text)
    );
  end if;

  return new;
end;
$$;

revoke all on function public.handle_license_command_transition() from public;

drop trigger if exists licenses_enqueue_command on public.licenses;
create trigger licenses_enqueue_command
after insert or update of status on public.licenses
for each row execute function public.handle_license_command_transition();

create or replace function public.handle_entitlement_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.enqueue_license_command_internal(
    new.license_id,
    'sync_entitlements',
    'License entitlements changed',
    auth.uid(),
    '{}'::jsonb,
    concat('license:', new.license_id::text, ':sync_entitlements:tx:', txid_current()::text)
  );
  return new;
end;
$$;

revoke all on function public.handle_entitlement_sync() from public;

drop trigger if exists entitlements_enqueue_sync on public.entitlements;
create trigger entitlements_enqueue_sync
after insert or update of value on public.entitlements
for each row execute function public.handle_entitlement_sync();

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
  )
  update public.product_commands command
  set status = 'processing',
      attempts = command.attempts + 1,
      locked_at = now(),
      locked_by = btrim(worker_id_value),
      last_error = null
  from candidates
  where command.id = candidates.id
  returning command.*;
end;
$$;

revoke all on function public.claim_product_commands(text, integer) from public;
grant execute on function public.claim_product_commands(text, integer) to service_role;

create or replace function public.complete_product_command(
  target_command_id uuid,
  succeeded boolean,
  response_value jsonb default null,
  error_value text default null,
  external_tenant_id_value text default null
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
    if command_record.attempts < command_record.max_attempts then
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
    jsonb_build_object('attempt', command_record.attempts, 'response', response_value)
  );

  return next_status;
end;
$$;

revoke all on function public.complete_product_command(uuid, boolean, jsonb, text, text) from public;
grant execute on function public.complete_product_command(uuid, boolean, jsonb, text, text) to service_role;

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
  left join public.product_endpoints e
    on e.adapter_id = a.id
   and e.environment = 'production'
   and e.status in ('active', 'maintenance')
  where a.product_id = command_record.product_id
    and a.status in ('active', 'degraded')
  order by case e.status when 'active' then 0 else 1 end
  limit 1;

  update public.product_commands
  set status = 'queued',
      adapter_id = adapter_id_value,
      endpoint_id = endpoint_id_value,
      attempts = 0,
      available_at = now(),
      completed_at = null,
      locked_at = null,
      locked_by = null,
      last_error = case when endpoint_id_value is null then 'Production endpoint is not configured or active' else null end
  where id = target_command_id;

  update public.workflow_runs
  set status = 'queued',
      attempts = 0,
      scheduled_at = now(),
      finished_at = null,
      error = null
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

create or replace function public.cancel_product_command(
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
begin
  if not public.can_manage_operations() then
    raise exception 'Insufficient permission to cancel product commands';
  end if;
  if length(btrim(coalesce(reason_value, ''))) < 5 then
    raise exception 'Cancellation reason must contain at least 5 characters';
  end if;

  select * into command_record
  from public.product_commands
  where id = target_command_id
  for update;
  if not found then raise exception 'Product command not found'; end if;
  if command_record.status not in ('queued', 'failed', 'dead_letter') then
    raise exception 'Command cannot be cancelled in its current state';
  end if;

  update public.product_commands
  set status = 'cancelled',
      completed_at = now(),
      last_error = btrim(reason_value),
      locked_at = null,
      locked_by = null
  where id = target_command_id;

  update public.workflow_runs
  set status = 'cancelled',
      error = btrim(reason_value),
      finished_at = now()
  where id = command_record.workflow_run_id;

  insert into public.workflow_events (
    workflow_run_id, product_command_id, event_type,
    from_status, to_status, message
  ) values (
    command_record.workflow_run_id,
    target_command_id,
    'command.cancelled',
    command_record.status::text,
    'cancelled',
    btrim(reason_value)
  );

  perform public.write_audit_event(
    'product_command.cancelled', 'product_command', target_command_id::text,
    command_record.organization_id, btrim(reason_value), to_jsonb(command_record),
    (select to_jsonb(c) from public.product_commands c where c.id = target_command_id)
  );
end;
$$;

revoke all on function public.cancel_product_command(uuid, text) from public;
grant execute on function public.cancel_product_command(uuid, text) to authenticated;

comment on table public.product_commands is
  'Durable product command outbox processed by a trusted provisioning worker.';
comment on function public.claim_product_commands(text, integer) is
  'Claims due commands with SKIP LOCKED so multiple workers can process safely.';
