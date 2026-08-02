-- Trusted worker APIs, inbound webhook ingestion and API gateway authentication.
-- These functions are intentionally service-role only unless an explicit administrative
-- control is required from the Super Admin UI.

create table public.api_scope_catalog (
  key text primary key,
  description text not null,
  risk_level public.approval_risk_level not null default 'low',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (key ~ '^[a-z0-9]+([._-][a-z0-9]+)+$')
);

insert into public.api_scope_catalog (key, description, risk_level) values
  ('health.read', 'Read control-plane and product health.', 'low'),
  ('products.read', 'Read the Product Registry.', 'low'),
  ('organizations.read', 'Read organization metadata within the client scope.', 'medium'),
  ('integrations.read', 'Read integration connection status within the client scope.', 'medium'),
  ('events.publish', 'Publish versioned platform events.', 'high'),
  ('webhooks.read', 'Read webhook delivery metadata.', 'medium'),
  ('subscriptions.read', 'Read subscription and license metadata.', 'high')
on conflict (key) do update
set description = excluded.description,
    risk_level = excluded.risk_level,
    is_active = true;

alter table public.api_scope_catalog enable row level security;
create policy api_scope_catalog_platform_staff_select
on public.api_scope_catalog for select
to authenticated
using (public.is_platform_staff());
grant select on public.api_scope_catalog to authenticated;
revoke insert, update, delete on public.api_scope_catalog from authenticated;

create or replace function public.rotate_inbound_webhook_token(
  endpoint_id_value uuid,
  reason_value text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  endpoint_record public.inbound_webhook_endpoints%rowtype;
  organization_id_value uuid;
  plaintext_token text;
begin
  if not public.can_manage_integrations() then
    raise exception 'Integration manager role required';
  end if;

  if char_length(btrim(coalesce(reason_value, ''))) < 5 then
    raise exception 'Reason must contain at least 5 characters';
  end if;

  select * into endpoint_record
  from public.inbound_webhook_endpoints
  where id = endpoint_id_value
    and archived_at is null
  for update;

  if not found then
    raise exception 'Webhook endpoint not found';
  end if;

  if endpoint_record.verification_mode not in ('bearer_token','query_token','meta_verify_token') then
    raise exception 'Selected verification mode does not use a generated token';
  end if;

  plaintext_token := encode(gen_random_bytes(32), 'hex');

  update public.inbound_webhook_endpoints
  set token_hash = encode(digest(plaintext_token, 'sha256'), 'hex')
  where id = endpoint_id_value;

  select integration.organization_id into organization_id_value
  from public.integrations integration
  where integration.id = endpoint_record.integration_id;

  perform public.write_audit_event(
    'integration.webhook_endpoint.token_rotated',
    'inbound_webhook_endpoint',
    endpoint_id_value::text,
    organization_id_value,
    reason_value,
    null,
    jsonb_build_object('rotatedAt', now())
  );

  return plaintext_token;
end;
$$;

create or replace function public.set_inbound_webhook_endpoint_status(
  endpoint_id_value uuid,
  status_value text,
  reason_value text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  endpoint_record public.inbound_webhook_endpoints%rowtype;
  organization_id_value uuid;
begin
  if not public.can_manage_integrations() then
    raise exception 'Integration manager role required';
  end if;

  if status_value not in ('active','paused','disabled') then
    raise exception 'Unsupported webhook endpoint status';
  end if;

  if char_length(btrim(coalesce(reason_value, ''))) < 5 then
    raise exception 'Reason must contain at least 5 characters';
  end if;

  select * into endpoint_record
  from public.inbound_webhook_endpoints
  where id = endpoint_id_value
    and archived_at is null
  for update;

  if not found then
    raise exception 'Webhook endpoint not found';
  end if;

  update public.inbound_webhook_endpoints
  set status = status_value,
      archived_at = case when status_value = 'disabled' then now() else archived_at end
  where id = endpoint_id_value;

  select integration.organization_id into organization_id_value
  from public.integrations integration
  where integration.id = endpoint_record.integration_id;

  perform public.write_audit_event(
    'integration.webhook_endpoint.status_changed',
    'inbound_webhook_endpoint',
    endpoint_id_value::text,
    organization_id_value,
    reason_value,
    jsonb_build_object('status', endpoint_record.status),
    jsonb_build_object('status', status_value)
  );
end;
$$;

create or replace function public.set_outbound_webhook_subscription_status(
  subscription_id_value uuid,
  status_value public.outbound_webhook_subscription_status,
  reason_value text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  subscription_record public.outbound_webhook_subscriptions%rowtype;
begin
  if not public.can_manage_integrations() then
    raise exception 'Integration manager role required';
  end if;

  if char_length(btrim(coalesce(reason_value, ''))) < 5 then
    raise exception 'Reason must contain at least 5 characters';
  end if;

  select * into subscription_record
  from public.outbound_webhook_subscriptions
  where id = subscription_id_value
    and archived_at is null
  for update;

  if not found then
    raise exception 'Outbound webhook subscription not found';
  end if;

  update public.outbound_webhook_subscriptions
  set status = status_value,
      archived_at = case when status_value = 'disabled' then now() else archived_at end
  where id = subscription_id_value;

  perform public.write_audit_event(
    'integration.outbound_subscription.status_changed',
    'outbound_webhook_subscription',
    subscription_id_value::text,
    subscription_record.organization_id,
    reason_value,
    jsonb_build_object('status', subscription_record.status),
    jsonb_build_object('status', status_value)
  );
end;
$$;

create or replace function public.register_inbound_webhook_event(
  endpoint_public_key_value text,
  provider_event_id_value text,
  event_type_value text,
  headers_value jsonb,
  query_params_value jsonb,
  payload_value jsonb,
  payload_hash_value text,
  signature_valid_value boolean,
  source_ip_value inet,
  rejection_reason_value text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  endpoint_record public.inbound_webhook_endpoints%rowtype;
  connection_record public.integrations%rowtype;
  existing_event_id uuid;
  event_id_value uuid;
  event_status_value public.inbound_webhook_event_status;
  job_id_value uuid;
  normalized_provider_event_id text := nullif(btrim(provider_event_id_value), '');
  normalized_event_type text := nullif(btrim(event_type_value), '');
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;

  select * into endpoint_record
  from public.inbound_webhook_endpoints
  where public_key = endpoint_public_key_value
    and status = 'active'
    and archived_at is null;

  if not found then
    return jsonb_build_object('accepted', false, 'reason', 'endpoint_unavailable');
  end if;

  select * into connection_record
  from public.integrations
  where id = endpoint_record.integration_id
    and archived_at is null;

  if not found or connection_record.status in ('revoked','suspended') then
    return jsonb_build_object('accepted', false, 'reason', 'connection_unavailable');
  end if;

  if cardinality(endpoint_record.allowed_ip_cidrs) > 0
     and source_ip_value is not null
     and not exists (
       select 1
       from unnest(endpoint_record.allowed_ip_cidrs) allowed_network
       where source_ip_value <<= allowed_network
     ) then
    signature_valid_value := false;
    rejection_reason_value := coalesce(rejection_reason_value, 'source_ip_not_allowed');
  end if;

  if cardinality(endpoint_record.allowed_event_types) > 0
     and normalized_event_type is not null
     and not normalized_event_type = any(endpoint_record.allowed_event_types) then
    signature_valid_value := false;
    rejection_reason_value := coalesce(rejection_reason_value, 'event_type_not_allowed');
  end if;

  if normalized_provider_event_id is not null then
    select id into existing_event_id
    from public.inbound_webhook_events
    where endpoint_id = endpoint_record.id
      and provider_event_id = normalized_provider_event_id
    limit 1;
  end if;

  if existing_event_id is not null then
    return jsonb_build_object(
      'accepted', true,
      'duplicate', true,
      'eventId', existing_event_id,
      'status', 'duplicate'
    );
  end if;

  event_status_value := case
    when signature_valid_value then 'queued'::public.inbound_webhook_event_status
    else 'rejected'::public.inbound_webhook_event_status
  end;

  insert into public.inbound_webhook_events (
    endpoint_id,
    integration_id,
    provider_event_id,
    event_type,
    headers,
    query_params,
    payload,
    payload_hash,
    signature_valid,
    source_ip,
    status,
    last_error
  ) values (
    endpoint_record.id,
    endpoint_record.integration_id,
    normalized_provider_event_id,
    normalized_event_type,
    coalesce(headers_value, '{}'::jsonb),
    coalesce(query_params_value, '{}'::jsonb),
    coalesce(payload_value, '{}'::jsonb),
    payload_hash_value,
    signature_valid_value,
    source_ip_value,
    event_status_value,
    case when signature_valid_value then null else left(coalesce(rejection_reason_value, 'signature_invalid'), 2000) end
  ) returning id into event_id_value;

  update public.inbound_webhook_endpoints
  set last_received_at = now()
  where id = endpoint_record.id;

  if signature_valid_value then
    insert into public.integration_jobs (
      integration_id,
      inbound_event_id,
      job_type,
      status,
      idempotency_key,
      payload,
      max_attempts
    ) values (
      endpoint_record.integration_id,
      event_id_value,
      'process_webhook',
      'queued',
      concat_ws(':', 'webhook', endpoint_record.id::text, coalesce(normalized_provider_event_id, payload_hash_value)),
      jsonb_build_object(
        'eventId', event_id_value,
        'eventType', normalized_event_type,
        'payload', coalesce(payload_value, '{}'::jsonb)
      ),
      8
    )
    on conflict (idempotency_key) do update
      set updated_at = public.integration_jobs.updated_at
    returning id into job_id_value;
  end if;

  return jsonb_build_object(
    'accepted', signature_valid_value,
    'duplicate', false,
    'eventId', event_id_value,
    'jobId', job_id_value,
    'status', event_status_value,
    'reason', case when signature_valid_value then null else rejection_reason_value end
  );
end;
$$;

create or replace function public.claim_integration_jobs(
  worker_id_value text,
  batch_size_value integer default 10
)
returns table (
  job_id uuid,
  integration_id uuid,
  organization_id uuid,
  product_id uuid,
  provider_key text,
  provider_name text,
  environment public.integration_environment,
  auth_type public.integration_auth_type,
  secret_reference text,
  connection_config jsonb,
  external_account_id text,
  job_type public.integration_job_type,
  payload jsonb,
  attempt_count integer,
  max_attempts integer,
  correlation_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;

  return query
  with selected as (
    select job.id
    from public.integration_jobs job
    join public.integrations connection on connection.id = job.integration_id
    where job.status in ('queued','failed')
      and job.available_at <= now()
      and job.attempt_count < job.max_attempts
      and connection.archived_at is null
      and connection.status not in ('revoked','suspended')
    order by job.available_at, job.created_at
    for update of job skip locked
    limit greatest(1, least(coalesce(batch_size_value, 10), 100))
  ), claimed as (
    update public.integration_jobs job
    set status = 'processing',
        locked_at = now(),
        locked_by = worker_id_value,
        started_at = coalesce(job.started_at, now()),
        attempt_count = job.attempt_count + 1
    from selected
    where job.id = selected.id
    returning job.*
  )
  select
    claimed.id,
    connection.id,
    connection.organization_id,
    connection.product_id,
    provider.key,
    provider.name,
    connection.environment,
    connection.auth_type,
    connection.secret_reference,
    connection.config,
    connection.external_account_id,
    claimed.job_type,
    claimed.payload,
    claimed.attempt_count,
    claimed.max_attempts,
    claimed.correlation_id
  from claimed
  join public.integrations connection on connection.id = claimed.integration_id
  join public.integration_providers provider on provider.id = connection.provider_id;
end;
$$;

create or replace function public.complete_integration_job(
  job_id_value uuid,
  worker_id_value text,
  succeeded_value boolean,
  retryable_value boolean,
  response_value jsonb,
  error_value text,
  external_account_id_value text default null,
  external_account_name_value text default null,
  token_expires_at_value timestamptz default null,
  sync_cursor_value jsonb default null
)
returns public.integration_job_status
language plpgsql
security definer
set search_path = public
as $$
declare
  job_record public.integration_jobs%rowtype;
  connection_record public.integrations%rowtype;
  next_status public.integration_job_status;
  retry_delay_seconds integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;

  select * into job_record
  from public.integration_jobs
  where id = job_id_value
  for update;

  if not found then
    raise exception 'Integration job not found';
  end if;

  if job_record.status <> 'processing' or job_record.locked_by is distinct from worker_id_value then
    raise exception 'Worker does not own this job lease';
  end if;

  select * into connection_record
  from public.integrations
  where id = job_record.integration_id
  for update;

  if succeeded_value then
    next_status := 'succeeded';

    update public.integration_jobs
    set status = next_status,
        response = coalesce(response_value, '{}'::jsonb),
        last_error = null,
        finished_at = now(),
        locked_at = null,
        locked_by = null
    where id = job_id_value;

    update public.integrations
    set status = case when job_record.job_type = 'disconnect' then 'disconnected' else 'connected' end,
        health_status = case when job_record.job_type = 'disconnect' then health_status else 'healthy' end,
        external_account_id = coalesce(nullif(btrim(external_account_id_value), ''), external_account_id),
        external_account_name = coalesce(nullif(btrim(external_account_name_value), ''), external_account_name),
        token_expires_at = coalesce(token_expires_at_value, token_expires_at),
        sync_cursor = coalesce(sync_cursor_value, sync_cursor),
        last_sync_at = case when job_record.job_type in ('sync','incremental_sync','full_sync','process_webhook') then now() else last_sync_at end,
        last_error = null,
        connected_at = case when job_record.job_type <> 'disconnect' then coalesce(connected_at, now()) else connected_at end,
        disconnected_at = case when job_record.job_type = 'disconnect' then now() else disconnected_at end
    where id = connection_record.id;

    if job_record.inbound_event_id is not null then
      update public.inbound_webhook_events
      set status = 'processed',
          processed_at = now(),
          last_error = null
      where id = job_record.inbound_event_id;
    end if;
  else
    retry_delay_seconds := least(900, (power(2, greatest(job_record.attempt_count - 1, 0))::integer) * 15);

    next_status := case
      when retryable_value and job_record.attempt_count < job_record.max_attempts then 'failed'
      else 'dead_letter'
    end;

    update public.integration_jobs
    set status = next_status,
        response = coalesce(response_value, response),
        last_error = left(coalesce(error_value, 'Integration job failed'), 4000),
        available_at = case when next_status = 'failed' then now() + make_interval(secs => retry_delay_seconds) else available_at end,
        finished_at = case when next_status = 'dead_letter' then now() else null end,
        locked_at = null,
        locked_by = null
    where id = job_id_value;

    update public.integrations
    set status = case when next_status = 'dead_letter' then 'error' else 'degraded' end,
        health_status = case when next_status = 'dead_letter' then 'unhealthy' else 'degraded' end,
        last_error = left(coalesce(error_value, 'Integration job failed'), 4000)
    where id = connection_record.id;

    if job_record.inbound_event_id is not null then
      update public.inbound_webhook_events
      set status = case when next_status = 'dead_letter' then 'dead_letter' else 'failed' end,
          attempt_count = attempt_count + 1,
          available_at = case when next_status = 'failed' then now() + make_interval(secs => retry_delay_seconds) else available_at end,
          last_error = left(coalesce(error_value, 'Webhook processing failed'), 4000)
      where id = job_record.inbound_event_id;
    end if;
  end if;

  insert into public.integration_connection_events (
    integration_id,
    event_type,
    reason,
    after_state,
    correlation_id
  ) values (
    connection_record.id,
    case when succeeded_value then 'sync_completed' else 'sync_failed' end,
    case when succeeded_value then 'Worker completed integration job' else left(coalesce(error_value, 'Integration job failed'), 1000) end,
    jsonb_build_object('jobId', job_id_value, 'jobType', job_record.job_type, 'status', next_status),
    job_record.correlation_id
  );

  return next_status;
end;
$$;

create or replace function public.requeue_stale_integration_jobs(
  stale_after_seconds_value integer default 300
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;

  update public.integration_jobs
  set status = case when attempt_count < max_attempts then 'failed' else 'dead_letter' end,
      available_at = now(),
      locked_at = null,
      locked_by = null,
      last_error = 'Worker lease expired',
      finished_at = case when attempt_count >= max_attempts then now() else null end
  where status = 'processing'
    and locked_at < now() - make_interval(secs => greatest(30, stale_after_seconds_value));

  get diagnostics affected_count = row_count;
  return affected_count;
end;
$$;

create or replace function public.claim_outbound_webhook_deliveries(
  worker_id_value text,
  batch_size_value integer default 20
)
returns table (
  delivery_id uuid,
  subscription_id uuid,
  target_url text,
  secret_reference text,
  custom_headers jsonb,
  timeout_ms integer,
  allowed_response_codes integer[],
  event_id uuid,
  event_type text,
  organization_id uuid,
  product_id uuid,
  payload jsonb,
  idempotency_key text,
  correlation_id uuid,
  attempt_count integer,
  max_attempts integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;

  return query
  with selected as (
    select delivery.id
    from public.outbound_webhook_deliveries delivery
    join public.outbound_webhook_subscriptions subscription on subscription.id = delivery.subscription_id
    where delivery.status in ('queued','failed')
      and delivery.available_at <= now()
      and delivery.attempt_count < delivery.max_attempts
      and subscription.status = 'active'
      and subscription.archived_at is null
    order by delivery.available_at, delivery.created_at
    for update of delivery skip locked
    limit greatest(1, least(coalesce(batch_size_value, 20), 100))
  ), claimed as (
    update public.outbound_webhook_deliveries delivery
    set status = 'processing',
        locked_at = now(),
        locked_by = worker_id_value,
        started_at = coalesce(delivery.started_at, now()),
        attempt_count = delivery.attempt_count + 1
    from selected
    where delivery.id = selected.id
    returning delivery.*
  )
  select
    claimed.id,
    subscription.id,
    subscription.target_url,
    subscription.secret_reference,
    subscription.headers,
    subscription.timeout_ms,
    subscription.allowed_response_codes,
    event.id,
    event.event_type,
    event.organization_id,
    event.product_id,
    event.payload,
    claimed.idempotency_key,
    claimed.correlation_id,
    claimed.attempt_count,
    claimed.max_attempts
  from claimed
  join public.outbound_webhook_subscriptions subscription on subscription.id = claimed.subscription_id
  join public.platform_events event on event.id = claimed.platform_event_id;
end;
$$;

create or replace function public.complete_outbound_webhook_delivery(
  delivery_id_value uuid,
  worker_id_value text,
  succeeded_value boolean,
  retryable_value boolean,
  response_status_value integer,
  response_headers_value jsonb,
  response_body_value text,
  error_value text
)
returns public.outbound_webhook_delivery_status
language plpgsql
security definer
set search_path = public
as $$
declare
  delivery_record public.outbound_webhook_deliveries%rowtype;
  next_status public.outbound_webhook_delivery_status;
  retry_delay_seconds integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;

  select * into delivery_record
  from public.outbound_webhook_deliveries
  where id = delivery_id_value
  for update;

  if not found then
    raise exception 'Webhook delivery not found';
  end if;

  if delivery_record.status <> 'processing' or delivery_record.locked_by is distinct from worker_id_value then
    raise exception 'Worker does not own this delivery lease';
  end if;

  if succeeded_value then
    next_status := 'succeeded';
  else
    next_status := case
      when retryable_value and delivery_record.attempt_count < delivery_record.max_attempts then 'failed'
      else 'dead_letter'
    end;
  end if;

  retry_delay_seconds := least(1800, (power(2, greatest(delivery_record.attempt_count - 1, 0))::integer) * 20);

  update public.outbound_webhook_deliveries
  set status = next_status,
      response_status = response_status_value,
      response_headers = coalesce(response_headers_value, '{}'::jsonb),
      response_body = left(coalesce(response_body_value, ''), 16000),
      last_error = case when succeeded_value then null else left(coalesce(error_value, 'Webhook delivery failed'), 4000) end,
      available_at = case when next_status = 'failed' then now() + make_interval(secs => retry_delay_seconds) else available_at end,
      finished_at = case when next_status in ('succeeded','dead_letter') then now() else null end,
      locked_at = null,
      locked_by = null
  where id = delivery_id_value;

  return next_status;
end;
$$;

create or replace function public.requeue_stale_outbound_webhook_deliveries(
  stale_after_seconds_value integer default 300
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;

  update public.outbound_webhook_deliveries
  set status = case when attempt_count < max_attempts then 'failed' else 'dead_letter' end,
      available_at = now(),
      locked_at = null,
      locked_by = null,
      last_error = 'Worker lease expired',
      finished_at = case when attempt_count >= max_attempts then now() else null end
  where status = 'processing'
    and locked_at < now() - make_interval(secs => greatest(30, stale_after_seconds_value));

  get diagnostics affected_count = row_count;
  return affected_count;
end;
$$;

create or replace function public.authenticate_api_client(
  api_key_value text,
  source_ip_value inet,
  required_scope_value text,
  request_id_value text,
  method_value text,
  path_value text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_record public.api_clients%rowtype;
  current_bucket timestamptz := date_trunc('minute', now());
  current_count integer;
  key_hash_value text;
  denial_reason text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;

  key_hash_value := encode(digest(api_key_value, 'sha256'), 'hex');

  select * into client_record
  from public.api_clients
  where key_hash = key_hash_value
  for update;

  if not found then
    denial_reason := 'invalid_api_key';
  elsif client_record.status <> 'active' then
    denial_reason := 'client_not_active';
  elsif client_record.expires_at is not null and client_record.expires_at <= now() then
    update public.api_clients set status = 'expired' where id = client_record.id;
    denial_reason := 'client_expired';
  elsif not required_scope_value = any(client_record.scopes) then
    denial_reason := 'scope_denied';
  elsif cardinality(client_record.allowed_ip_cidrs) > 0
        and source_ip_value is not null
        and not exists (
          select 1 from unnest(client_record.allowed_ip_cidrs) allowed_network
          where source_ip_value <<= allowed_network
        ) then
    denial_reason := 'source_ip_denied';
  end if;

  if denial_reason is not null then
    insert into public.api_request_logs (
      api_client_id,
      request_id,
      method,
      path,
      required_scope,
      source_ip,
      status_code
    ) values (
      client_record.id,
      coalesce(nullif(btrim(request_id_value), ''), gen_random_uuid()::text),
      upper(coalesce(method_value, 'GET')),
      coalesce(path_value, '/'),
      required_scope_value,
      source_ip_value,
      case when denial_reason = 'scope_denied' then 403 else 401 end
    );

    return jsonb_build_object('authorized', false, 'reason', denial_reason);
  end if;

  insert into public.api_rate_limit_buckets (api_client_id, minute_bucket, request_count)
  values (client_record.id, current_bucket, 1)
  on conflict (api_client_id, minute_bucket) do update
  set request_count = public.api_rate_limit_buckets.request_count + 1
  returning request_count into current_count;

  if current_count > client_record.rate_limit_per_minute then
    insert into public.api_request_logs (
      api_client_id,
      request_id,
      method,
      path,
      required_scope,
      source_ip,
      status_code
    ) values (
      client_record.id,
      coalesce(nullif(btrim(request_id_value), ''), gen_random_uuid()::text),
      upper(coalesce(method_value, 'GET')),
      coalesce(path_value, '/'),
      required_scope_value,
      source_ip_value,
      429
    );

    return jsonb_build_object(
      'authorized', false,
      'reason', 'rate_limit_exceeded',
      'rateLimit', client_record.rate_limit_per_minute,
      'currentCount', current_count
    );
  end if;

  update public.api_clients
  set last_used_at = now()
  where id = client_record.id;

  return jsonb_build_object(
    'authorized', true,
    'clientId', client_record.id,
    'organizationId', client_record.organization_id,
    'scopes', client_record.scopes,
    'rateLimit', client_record.rate_limit_per_minute,
    'currentCount', current_count
  );
end;
$$;

create or replace function public.log_api_request(
  api_client_id_value uuid,
  request_id_value text,
  method_value text,
  path_value text,
  required_scope_value text,
  source_ip_value inet,
  status_code_value integer,
  duration_ms_value integer,
  correlation_id_value uuid default gen_random_uuid()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;

  insert into public.api_request_logs (
    api_client_id,
    request_id,
    method,
    path,
    required_scope,
    source_ip,
    status_code,
    duration_ms,
    correlation_id
  ) values (
    api_client_id_value,
    coalesce(nullif(btrim(request_id_value), ''), gen_random_uuid()::text),
    upper(coalesce(method_value, 'GET')),
    coalesce(path_value, '/'),
    required_scope_value,
    source_ip_value,
    greatest(100, least(status_code_value, 599)),
    case when duration_ms_value is null then null else greatest(0, duration_ms_value) end,
    correlation_id_value
  );
end;
$$;

create or replace function public.prune_integration_runtime_data(
  api_log_retention_days integer default 90,
  successful_delivery_retention_days integer default 30,
  successful_job_retention_days integer default 30,
  rate_bucket_retention_hours integer default 24
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_api_logs integer;
  deleted_deliveries integer;
  deleted_jobs integer;
  deleted_buckets integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;

  delete from public.api_request_logs
  where created_at < now() - make_interval(days => greatest(7, api_log_retention_days));
  get diagnostics deleted_api_logs = row_count;

  delete from public.outbound_webhook_deliveries
  where status = 'succeeded'
    and finished_at < now() - make_interval(days => greatest(7, successful_delivery_retention_days));
  get diagnostics deleted_deliveries = row_count;

  delete from public.integration_jobs
  where status = 'succeeded'
    and finished_at < now() - make_interval(days => greatest(7, successful_job_retention_days));
  get diagnostics deleted_jobs = row_count;

  delete from public.api_rate_limit_buckets
  where minute_bucket < now() - make_interval(hours => greatest(1, rate_bucket_retention_hours));
  get diagnostics deleted_buckets = row_count;

  return jsonb_build_object(
    'apiLogs', deleted_api_logs,
    'deliveries', deleted_deliveries,
    'jobs', deleted_jobs,
    'rateBuckets', deleted_buckets
  );
end;
$$;

revoke all on function public.rotate_inbound_webhook_token(uuid, text) from public;
revoke all on function public.set_inbound_webhook_endpoint_status(uuid, text, text) from public;
revoke all on function public.set_outbound_webhook_subscription_status(uuid, public.outbound_webhook_subscription_status, text) from public;
revoke all on function public.register_inbound_webhook_event(text, text, text, jsonb, jsonb, jsonb, text, boolean, inet, text) from public;
revoke all on function public.claim_integration_jobs(text, integer) from public;
revoke all on function public.complete_integration_job(uuid, text, boolean, boolean, jsonb, text, text, text, timestamptz, jsonb) from public;
revoke all on function public.requeue_stale_integration_jobs(integer) from public;
revoke all on function public.claim_outbound_webhook_deliveries(text, integer) from public;
revoke all on function public.complete_outbound_webhook_delivery(uuid, text, boolean, boolean, integer, jsonb, text, text) from public;
revoke all on function public.requeue_stale_outbound_webhook_deliveries(integer) from public;
revoke all on function public.authenticate_api_client(text, inet, text, text, text, text) from public;
revoke all on function public.log_api_request(uuid, text, text, text, text, inet, integer, integer, uuid) from public;
revoke all on function public.prune_integration_runtime_data(integer, integer, integer, integer) from public;

grant execute on function public.rotate_inbound_webhook_token(uuid, text) to authenticated;
grant execute on function public.set_inbound_webhook_endpoint_status(uuid, text, text) to authenticated;
grant execute on function public.set_outbound_webhook_subscription_status(uuid, public.outbound_webhook_subscription_status, text) to authenticated;
grant execute on function public.register_inbound_webhook_event(text, text, text, jsonb, jsonb, jsonb, text, boolean, inet, text) to service_role;
grant execute on function public.claim_integration_jobs(text, integer) to service_role;
grant execute on function public.complete_integration_job(uuid, text, boolean, boolean, jsonb, text, text, text, timestamptz, jsonb) to service_role;
grant execute on function public.requeue_stale_integration_jobs(integer) to service_role;
grant execute on function public.claim_outbound_webhook_deliveries(text, integer) to service_role;
grant execute on function public.complete_outbound_webhook_delivery(uuid, text, boolean, boolean, integer, jsonb, text, text) to service_role;
grant execute on function public.requeue_stale_outbound_webhook_deliveries(integer) to service_role;
grant execute on function public.authenticate_api_client(text, inet, text, text, text, text) to service_role;
grant execute on function public.log_api_request(uuid, text, text, text, text, inet, integer, integer, uuid) to service_role;
grant execute on function public.prune_integration_runtime_data(integer, integer, integer, integer) to service_role;

comment on function public.register_inbound_webhook_event(text, text, text, jsonb, jsonb, jsonb, text, boolean, inet, text) is
  'Trusted webhook gateway RPC. Persists a sanitized event and enqueues idempotent processing.';
comment on function public.authenticate_api_client(text, inet, text, text, text, text) is
  'Service-only API key, scope, IP and per-minute rate-limit validation.';
comment on function public.claim_integration_jobs(text, integer) is
  'Claims durable integration jobs with SKIP LOCKED worker leases.';
comment on function public.claim_outbound_webhook_deliveries(text, integer) is
  'Claims durable outbound webhook deliveries with SKIP LOCKED worker leases.';
