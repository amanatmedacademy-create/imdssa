-- Integration Registry, webhook delivery plane and API gateway credentials.
-- Browser clients receive only metadata. Provider secrets and API key material are
-- referenced or hashed and are consumed by trusted Edge Functions/workers.

create type public.integration_provider_status as enum ('draft', 'active', 'degraded', 'disabled');
create type public.integration_connection_status as enum (
  'disconnected',
  'configuring',
  'connected',
  'degraded',
  'error',
  'suspended',
  'revoked'
);
create type public.integration_auth_type as enum (
  'oauth2',
  'api_key',
  'service_token',
  'hmac',
  'basic',
  'none'
);
create type public.integration_environment as enum ('sandbox', 'staging', 'production');
create type public.integration_job_type as enum (
  'test_connection',
  'sync',
  'incremental_sync',
  'full_sync',
  'refresh_token',
  'disconnect',
  'process_webhook'
);
create type public.integration_job_status as enum (
  'queued',
  'processing',
  'succeeded',
  'failed',
  'dead_letter',
  'cancelled'
);
create type public.inbound_webhook_event_status as enum (
  'received',
  'verified',
  'queued',
  'processing',
  'processed',
  'duplicate',
  'rejected',
  'failed',
  'dead_letter'
);
create type public.outbound_webhook_subscription_status as enum ('active', 'paused', 'disabled');
create type public.outbound_webhook_delivery_status as enum (
  'queued',
  'processing',
  'succeeded',
  'failed',
  'dead_letter',
  'cancelled'
);
create type public.api_client_status as enum ('active', 'suspended', 'revoked', 'expired');

create table public.integration_providers (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  category text not null,
  status public.integration_provider_status not null default 'draft',
  description text,
  auth_types public.integration_auth_type[] not null default '{}',
  capabilities text[] not null default '{}',
  supports_webhooks boolean not null default false,
  supports_incremental_sync boolean not null default false,
  supports_token_refresh boolean not null default false,
  documentation_url text,
  config_schema jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (key ~ '^[a-z0-9][a-z0-9._-]+$'),
  check (category ~ '^[a-z0-9][a-z0-9._-]+$')
);

create trigger integration_providers_set_updated_at
before update on public.integration_providers
for each row execute function public.set_updated_at();

insert into public.integration_providers (
  key,
  name,
  category,
  status,
  description,
  auth_types,
  capabilities,
  supports_webhooks,
  supports_incremental_sync,
  supports_token_refresh,
  documentation_url,
  metadata
) values
  (
    'meta_ads',
    'Meta Ads',
    'advertising',
    'active',
    'Advertising accounts, campaigns, creatives, leads and performance metrics.',
    array['oauth2','service_token']::public.integration_auth_type[],
    array['accounts.read','campaigns.read','campaigns.manage','insights.read','leads.read'],
    true,
    true,
    true,
    'https://developers.facebook.com/docs/marketing-apis/',
    '{"position":1,"brand":"meta"}'::jsonb
  ),
  (
    'whatsapp_business',
    'WhatsApp Business',
    'messaging',
    'active',
    'WABA numbers, templates, conversations, messages and delivery webhooks.',
    array['oauth2','service_token']::public.integration_auth_type[],
    array['messages.send','messages.read','templates.read','templates.manage','contacts.read'],
    true,
    false,
    true,
    'https://developers.facebook.com/docs/whatsapp/',
    '{"position":2,"brand":"whatsapp"}'::jsonb
  ),
  (
    'tiktok_ads',
    'TikTok Ads',
    'advertising',
    'active',
    'Advertisers, campaigns, creatives, leads and reporting.',
    array['oauth2','service_token']::public.integration_auth_type[],
    array['accounts.read','campaigns.read','campaigns.manage','insights.read','leads.read'],
    true,
    true,
    true,
    'https://business-api.tiktok.com/portal/docs',
    '{"position":3,"brand":"tiktok"}'::jsonb
  ),
  (
    'google_ads',
    'Google Ads',
    'advertising',
    'active',
    'Customer accounts, campaigns, conversions and reporting.',
    array['oauth2']::public.integration_auth_type[],
    array['accounts.read','campaigns.read','campaigns.manage','insights.read','conversions.write'],
    false,
    true,
    true,
    'https://developers.google.com/google-ads/api/docs/start',
    '{"position":4,"brand":"google"}'::jsonb
  ),
  (
    'kaspi',
    'Kaspi',
    'payments',
    'active',
    'Payment status, transaction reconciliation and payment notifications.',
    array['api_key','service_token','hmac']::public.integration_auth_type[],
    array['payments.read','payments.reconcile','refunds.read'],
    true,
    true,
    false,
    null,
    '{"position":5,"brand":"kaspi"}'::jsonb
  ),
  (
    'medvoice',
    'Medvoice',
    'medical',
    'active',
    'Appointment and patient workflow synchronization.',
    array['api_key','service_token']::public.integration_auth_type[],
    array['appointments.read','appointments.write','patients.read','statuses.read'],
    true,
    true,
    false,
    null,
    '{"position":6,"brand":"medvoice"}'::jsonb
  ),
  (
    'email',
    'Email',
    'communications',
    'active',
    'Transactional email delivery and delivery events.',
    array['api_key','service_token']::public.integration_auth_type[],
    array['messages.send','delivery.read','templates.manage'],
    true,
    false,
    false,
    null,
    '{"position":7,"brand":"email"}'::jsonb
  ),
  (
    'sms',
    'SMS',
    'communications',
    'active',
    'Transactional SMS delivery and status callbacks.',
    array['api_key','service_token']::public.integration_auth_type[],
    array['messages.send','delivery.read'],
    true,
    false,
    false,
    null,
    '{"position":8,"brand":"sms"}'::jsonb
  ),
  (
    'cloudflare',
    'Cloudflare',
    'infrastructure',
    'active',
    'Workers, Pages, DNS, deployments and operational health.',
    array['api_key','service_token']::public.integration_auth_type[],
    array['workers.read','workers.deploy','pages.read','dns.read','analytics.read'],
    true,
    true,
    false,
    'https://developers.cloudflare.com/api/',
    '{"position":9,"brand":"cloudflare"}'::jsonb
  ),
  (
    'workplace',
    'Workplace',
    'operations',
    'active',
    'Workplace authentication and staff workflow integration.',
    array['oauth2','service_token']::public.integration_auth_type[],
    array['users.read','groups.read','notifications.send'],
    true,
    true,
    true,
    null,
    '{"position":10,"brand":"workplace"}'::jsonb
  ),
  (
    'telephony',
    'Telephony',
    'communications',
    'active',
    'Calls, recordings, call events and agent status.',
    array['api_key','service_token','hmac']::public.integration_auth_type[],
    array['calls.read','calls.create','recordings.read','agents.read'],
    true,
    true,
    false,
    null,
    '{"position":11,"brand":"telephony"}'::jsonb
  )
on conflict (key) do update
set name = excluded.name,
    category = excluded.category,
    status = excluded.status,
    description = excluded.description,
    auth_types = excluded.auth_types,
    capabilities = excluded.capabilities,
    supports_webhooks = excluded.supports_webhooks,
    supports_incremental_sync = excluded.supports_incremental_sync,
    supports_token_refresh = excluded.supports_token_refresh,
    documentation_url = excluded.documentation_url,
    metadata = excluded.metadata,
    updated_at = now();

alter table public.integrations
  add column if not exists provider_id uuid references public.integration_providers(id) on delete restrict,
  add column if not exists display_name text,
  add column if not exists environment public.integration_environment not null default 'production',
  add column if not exists auth_type public.integration_auth_type,
  add column if not exists external_account_id text,
  add column if not exists external_account_name text,
  add column if not exists health_status text not null default 'unknown',
  add column if not exists connected_at timestamptz,
  add column if not exists disconnected_at timestamptz,
  add column if not exists next_sync_at timestamptz,
  add column if not exists sync_cursor jsonb not null default '{}'::jsonb,
  add column if not exists created_by uuid references public.platform_users(id),
  add column if not exists updated_by uuid references public.platform_users(id),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists archived_at timestamptz;

update public.integrations integration
set provider_id = provider.id,
    display_name = coalesce(integration.display_name, provider.name),
    auth_type = coalesce(integration.auth_type, provider.auth_types[1])
from public.integration_providers provider
where integration.provider_key = provider.key
  and integration.provider_id is null;

alter table public.integrations
  alter column provider_id set not null,
  add constraint integrations_health_status_check
  check (health_status in ('unknown', 'healthy', 'degraded', 'unhealthy')),
  add constraint integrations_status_check
  check (status in ('disconnected', 'configuring', 'connected', 'degraded', 'error', 'suspended', 'revoked')),
  add constraint integrations_secret_reference_check
  check (
    secret_reference is null
    or secret_reference ~ '^(env|vault|secret)://[A-Za-z0-9_./:-]+$'
  );

create trigger integrations_set_updated_at
before update on public.integrations
for each row execute function public.set_updated_at();

create index integrations_organization_provider_idx
on public.integrations (organization_id, provider_id, status)
where archived_at is null;

create index integrations_token_expiry_idx
on public.integrations (token_expires_at)
where token_expires_at is not null and archived_at is null;

create table public.integration_connection_events (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.integrations(id) on delete cascade,
  event_type text not null,
  actor_user_id uuid references public.platform_users(id),
  reason text,
  before_state jsonb,
  after_state jsonb,
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  check (event_type in (
    'created',
    'updated',
    'connected',
    'degraded',
    'errored',
    'suspended',
    'disconnected',
    'revoked',
    'token_refreshed',
    'secret_rotated',
    'sync_started',
    'sync_completed',
    'sync_failed'
  ))
);

create index integration_connection_events_connection_idx
on public.integration_connection_events (integration_id, created_at desc);

create table public.inbound_webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.integrations(id) on delete cascade,
  public_key text not null unique,
  name text not null,
  status text not null default 'active',
  verification_mode text not null default 'hmac_sha256',
  secret_reference text,
  token_hash text,
  signature_header text not null default 'x-signature',
  timestamp_header text,
  allowed_ip_cidrs cidr[] not null default '{}',
  allowed_event_types text[] not null default '{}',
  event_id_path text,
  event_type_path text,
  challenge_field text,
  max_payload_bytes integer not null default 1048576,
  last_received_at timestamptz,
  created_by uuid not null references public.platform_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (status in ('active', 'paused', 'disabled')),
  check (verification_mode in (
    'none',
    'hmac_sha256',
    'hmac_sha1',
    'bearer_token',
    'query_token',
    'meta_verify_token'
  )),
  check (max_payload_bytes between 1024 and 10485760),
  check (
    secret_reference is null
    or secret_reference ~ '^(env|vault|secret)://[A-Za-z0-9_./:-]+$'
  )
);

create trigger inbound_webhook_endpoints_set_updated_at
before update on public.inbound_webhook_endpoints
for each row execute function public.set_updated_at();

create index inbound_webhook_endpoints_integration_idx
on public.inbound_webhook_endpoints (integration_id, status)
where archived_at is null;

create table public.inbound_webhook_events (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null references public.inbound_webhook_endpoints(id) on delete cascade,
  integration_id uuid not null references public.integrations(id) on delete cascade,
  provider_event_id text,
  event_type text,
  headers jsonb not null default '{}'::jsonb,
  query_params jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  payload_hash text not null,
  signature_valid boolean not null default false,
  source_ip inet,
  status public.inbound_webhook_event_status not null default 'received',
  attempt_count integer not null default 0,
  max_attempts integer not null default 8,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  processed_at timestamptz,
  last_error text,
  correlation_id uuid not null default gen_random_uuid(),
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (attempt_count >= 0),
  check (max_attempts between 1 and 50)
);

create unique index inbound_webhook_events_provider_id_idx
on public.inbound_webhook_events (endpoint_id, provider_event_id)
where provider_event_id is not null;

create index inbound_webhook_events_queue_idx
on public.inbound_webhook_events (status, available_at)
where status in ('verified', 'queued', 'failed');

create index inbound_webhook_events_connection_idx
on public.inbound_webhook_events (integration_id, received_at desc);

create table public.integration_jobs (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.integrations(id) on delete cascade,
  inbound_event_id uuid references public.inbound_webhook_events(id) on delete set null,
  job_type public.integration_job_type not null,
  status public.integration_job_status not null default 'queued',
  idempotency_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  response jsonb,
  attempt_count integer not null default 0,
  max_attempts integer not null default 8,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  started_at timestamptz,
  finished_at timestamptz,
  last_error text,
  correlation_id uuid not null default gen_random_uuid(),
  created_by uuid references public.platform_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (attempt_count >= 0),
  check (max_attempts between 1 and 50)
);

create trigger integration_jobs_set_updated_at
before update on public.integration_jobs
for each row execute function public.set_updated_at();

create index integration_jobs_queue_idx
on public.integration_jobs (status, available_at)
where status in ('queued', 'failed');

create index integration_jobs_connection_idx
on public.integration_jobs (integration_id, created_at desc);

create table public.outbound_webhook_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  name text not null,
  target_url text not null,
  event_types text[] not null,
  secret_reference text,
  status public.outbound_webhook_subscription_status not null default 'active',
  timeout_ms integer not null default 10000,
  max_attempts integer not null default 8,
  allowed_response_codes integer[] not null default array[200,201,202,204],
  headers jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.platform_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (cardinality(event_types) > 0),
  check (target_url ~ '^https://'),
  check (timeout_ms between 1000 and 60000),
  check (max_attempts between 1 and 50),
  check (
    secret_reference is null
    or secret_reference ~ '^(env|vault|secret)://[A-Za-z0-9_./:-]+$'
  )
);

create trigger outbound_webhook_subscriptions_set_updated_at
before update on public.outbound_webhook_subscriptions
for each row execute function public.set_updated_at();

create index outbound_webhook_subscriptions_org_idx
on public.outbound_webhook_subscriptions (organization_id, status)
where archived_at is null;

create table public.platform_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  event_type text not null,
  subject_type text,
  subject_id text,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  check (event_type ~ '^[a-z0-9]+([._-][a-z0-9]+)+$')
);

create index platform_events_org_time_idx
on public.platform_events (organization_id, created_at desc);

create table public.outbound_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.outbound_webhook_subscriptions(id) on delete cascade,
  platform_event_id uuid not null references public.platform_events(id) on delete cascade,
  status public.outbound_webhook_delivery_status not null default 'queued',
  idempotency_key text not null unique,
  attempt_count integer not null default 0,
  max_attempts integer not null default 8,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  started_at timestamptz,
  finished_at timestamptz,
  response_status integer,
  response_headers jsonb,
  response_body text,
  last_error text,
  signature_version text not null default 'v1',
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (attempt_count >= 0),
  check (max_attempts between 1 and 50)
);

create trigger outbound_webhook_deliveries_set_updated_at
before update on public.outbound_webhook_deliveries
for each row execute function public.set_updated_at();

create index outbound_webhook_deliveries_queue_idx
on public.outbound_webhook_deliveries (status, available_at)
where status in ('queued', 'failed');

create table public.api_clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  name text not null,
  key_prefix text not null,
  key_hash text not null unique,
  status public.api_client_status not null default 'active',
  scopes text[] not null default '{}',
  allowed_ip_cidrs cidr[] not null default '{}',
  rate_limit_per_minute integer not null default 120,
  expires_at timestamptz,
  last_used_at timestamptz,
  created_by uuid not null references public.platform_users(id),
  revoked_by uuid references public.platform_users(id),
  revoked_at timestamptz,
  revoke_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(scopes) > 0),
  check (rate_limit_per_minute between 1 and 10000),
  check (expires_at is null or expires_at > created_at)
);

create trigger api_clients_set_updated_at
before update on public.api_clients
for each row execute function public.set_updated_at();

create index api_clients_org_status_idx
on public.api_clients (organization_id, status);

create table public.api_rate_limit_buckets (
  api_client_id uuid not null references public.api_clients(id) on delete cascade,
  minute_bucket timestamptz not null,
  request_count integer not null default 0,
  primary key (api_client_id, minute_bucket),
  check (request_count >= 0)
);

create table public.api_request_logs (
  id uuid primary key default gen_random_uuid(),
  api_client_id uuid references public.api_clients(id) on delete set null,
  request_id text not null,
  method text not null,
  path text not null,
  required_scope text,
  source_ip inet,
  status_code integer not null,
  duration_ms integer,
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  check (status_code between 100 and 599),
  check (duration_ms is null or duration_ms >= 0)
);

create index api_request_logs_client_time_idx
on public.api_request_logs (api_client_id, created_at desc);

create or replace function public.can_manage_integrations()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_global_role(array[
    'platform_owner'::public.global_role,
    'super_admin'::public.global_role,
    'technical_admin'::public.global_role
  ]);
$$;

revoke all on function public.can_manage_integrations() from public;
grant execute on function public.can_manage_integrations() to authenticated;

create or replace function public.prevent_integration_history_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Integration history is append-only';
end;
$$;

revoke all on function public.prevent_integration_history_mutation() from public;

create trigger integration_connection_events_immutable
before update or delete on public.integration_connection_events
for each row execute function public.prevent_integration_history_mutation();

create trigger platform_events_immutable
before update or delete on public.platform_events
for each row execute function public.prevent_integration_history_mutation();

create trigger api_request_logs_immutable
before update or delete on public.api_request_logs
for each row execute function public.prevent_integration_history_mutation();

create or replace function public.save_integration_connection(
  integration_id_value uuid,
  organization_id_value uuid,
  product_id_value uuid,
  provider_key_value text,
  display_name_value text,
  environment_value public.integration_environment,
  auth_type_value public.integration_auth_type,
  external_account_id_value text,
  external_account_name_value text,
  secret_reference_value text,
  config_value jsonb,
  reason_value text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  provider_record public.integration_providers%rowtype;
  before_record jsonb;
  result_id uuid;
begin
  if not public.can_manage_integrations() then
    raise exception 'Integration manager role required';
  end if;

  if char_length(btrim(coalesce(display_name_value, ''))) < 2 then
    raise exception 'Connection name must contain at least 2 characters';
  end if;

  if char_length(btrim(coalesce(reason_value, ''))) < 5 then
    raise exception 'Reason must contain at least 5 characters';
  end if;

  if not exists (
    select 1 from public.organizations
    where id = organization_id_value
      and status <> 'archived'
  ) then
    raise exception 'Organization is unavailable';
  end if;

  if product_id_value is not null and not exists (
    select 1 from public.products
    where id = product_id_value
      and archived_at is null
      and status <> 'disabled'
  ) then
    raise exception 'Product is unavailable';
  end if;

  select * into provider_record
  from public.integration_providers
  where key = provider_key_value
    and status <> 'disabled';

  if not found then
    raise exception 'Integration provider is unavailable';
  end if;

  if not auth_type_value = any(provider_record.auth_types) then
    raise exception 'Provider does not support the selected authentication type';
  end if;

  if auth_type_value <> 'none'
     and nullif(btrim(secret_reference_value), '') is null then
    raise exception 'Secret reference is required for this authentication mode';
  end if;

  if nullif(btrim(secret_reference_value), '') is not null
     and secret_reference_value !~ '^(env|vault|secret)://[A-Za-z0-9_./:-]+$' then
    raise exception 'Secret reference format is invalid';
  end if;

  if integration_id_value is null then
    insert into public.integrations (
      organization_id,
      product_id,
      provider_id,
      provider_key,
      display_name,
      environment,
      auth_type,
      external_account_id,
      external_account_name,
      status,
      health_status,
      secret_reference,
      config,
      created_by,
      updated_by
    ) values (
      organization_id_value,
      product_id_value,
      provider_record.id,
      provider_record.key,
      btrim(display_name_value),
      environment_value,
      auth_type_value,
      nullif(btrim(external_account_id_value), ''),
      nullif(btrim(external_account_name_value), ''),
      'configuring',
      'unknown',
      nullif(btrim(secret_reference_value), ''),
      coalesce(config_value, '{}'::jsonb),
      auth.uid(),
      auth.uid()
    ) returning id into result_id;

    insert into public.integration_connection_events (
      integration_id,
      event_type,
      actor_user_id,
      reason,
      after_state
    ) values (
      result_id,
      'created',
      auth.uid(),
      btrim(reason_value),
      (select to_jsonb(connection) - 'secret_reference' from public.integrations connection where connection.id = result_id)
    );
  else
    select to_jsonb(connection) - 'secret_reference' into before_record
    from public.integrations connection
    where connection.id = integration_id_value
      and connection.archived_at is null
    for update;

    if before_record is null then
      raise exception 'Integration connection not found';
    end if;

    update public.integrations
    set organization_id = organization_id_value,
        product_id = product_id_value,
        provider_id = provider_record.id,
        provider_key = provider_record.key,
        display_name = btrim(display_name_value),
        environment = environment_value,
        auth_type = auth_type_value,
        external_account_id = nullif(btrim(external_account_id_value), ''),
        external_account_name = nullif(btrim(external_account_name_value), ''),
        secret_reference = coalesce(nullif(btrim(secret_reference_value), ''), secret_reference),
        config = coalesce(config_value, '{}'::jsonb),
        updated_by = auth.uid()
    where id = integration_id_value
    returning id into result_id;

    insert into public.integration_connection_events (
      integration_id,
      event_type,
      actor_user_id,
      reason,
      before_state,
      after_state
    ) values (
      result_id,
      'updated',
      auth.uid(),
      btrim(reason_value),
      before_record,
      (select to_jsonb(connection) - 'secret_reference' from public.integrations connection where connection.id = result_id)
    );
  end if;

  perform public.write_audit_event(
    case when integration_id_value is null then 'integration.connection.created' else 'integration.connection.updated' end,
    'integration_connection',
    result_id::text,
    organization_id_value,
    reason_value,
    before_record,
    (select to_jsonb(connection) - 'secret_reference' from public.integrations connection where connection.id = result_id)
  );

  return result_id;
end;
$$;

create or replace function public.set_integration_connection_status(
  integration_id_value uuid,
  status_value public.integration_connection_status,
  reason_value text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  connection_record public.integrations%rowtype;
  event_type_value text;
begin
  if not public.can_manage_integrations() then
    raise exception 'Integration manager role required';
  end if;

  if char_length(btrim(coalesce(reason_value, ''))) < 5 then
    raise exception 'Reason must contain at least 5 characters';
  end if;

  select * into connection_record
  from public.integrations
  where id = integration_id_value
    and archived_at is null
  for update;

  if not found then
    raise exception 'Integration connection not found';
  end if;

  if connection_record.status = 'revoked' and status_value <> 'revoked' then
    raise exception 'Revoked connection cannot be reactivated';
  end if;

  event_type_value := case status_value
    when 'connected' then 'connected'
    when 'degraded' then 'degraded'
    when 'error' then 'errored'
    when 'suspended' then 'suspended'
    when 'disconnected' then 'disconnected'
    when 'revoked' then 'revoked'
    else 'updated'
  end;

  update public.integrations
  set status = status_value::text,
      health_status = case
        when status_value = 'connected' then 'healthy'
        when status_value = 'degraded' then 'degraded'
        when status_value in ('error','revoked') then 'unhealthy'
        else health_status
      end,
      connected_at = case when status_value = 'connected' then coalesce(connected_at, now()) else connected_at end,
      disconnected_at = case when status_value in ('disconnected','revoked') then now() else disconnected_at end,
      archived_at = case when status_value = 'revoked' then now() else archived_at end,
      updated_by = auth.uid()
  where id = integration_id_value;

  insert into public.integration_connection_events (
    integration_id,
    event_type,
    actor_user_id,
    reason,
    before_state,
    after_state
  ) values (
    integration_id_value,
    event_type_value,
    auth.uid(),
    btrim(reason_value),
    to_jsonb(connection_record) - 'secret_reference',
    (select to_jsonb(connection) - 'secret_reference' from public.integrations connection where connection.id = integration_id_value)
  );

  perform public.write_audit_event(
    'integration.connection.status_changed',
    'integration_connection',
    integration_id_value::text,
    connection_record.organization_id,
    reason_value,
    jsonb_build_object('status', connection_record.status),
    jsonb_build_object('status', status_value)
  );
end;
$$;

create or replace function public.enqueue_integration_job(
  integration_id_value uuid,
  job_type_value public.integration_job_type,
  payload_value jsonb,
  reason_value text,
  idempotency_key_value text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  connection_record public.integrations%rowtype;
  job_id_value uuid;
  normalized_key text;
begin
  if not public.can_manage_integrations() then
    raise exception 'Integration manager role required';
  end if;

  if char_length(btrim(coalesce(reason_value, ''))) < 5 then
    raise exception 'Reason must contain at least 5 characters';
  end if;

  select * into connection_record
  from public.integrations
  where id = integration_id_value
    and archived_at is null;

  if not found then
    raise exception 'Integration connection not found';
  end if;

  if connection_record.status = 'revoked' then
    raise exception 'Revoked connection cannot receive jobs';
  end if;

  normalized_key := coalesce(
    nullif(btrim(idempotency_key_value), ''),
    concat_ws(':', 'integration', integration_id_value::text, job_type_value::text, gen_random_uuid()::text)
  );

  select id into job_id_value
  from public.integration_jobs
  where idempotency_key = normalized_key;

  if job_id_value is not null then
    return job_id_value;
  end if;

  insert into public.integration_jobs (
    integration_id,
    job_type,
    status,
    idempotency_key,
    payload,
    created_by
  ) values (
    integration_id_value,
    job_type_value,
    'queued',
    normalized_key,
    coalesce(payload_value, '{}'::jsonb),
    auth.uid()
  ) returning id into job_id_value;

  insert into public.integration_connection_events (
    integration_id,
    event_type,
    actor_user_id,
    reason,
    after_state
  ) values (
    integration_id_value,
    'sync_started',
    auth.uid(),
    btrim(reason_value),
    jsonb_build_object('jobId', job_id_value, 'jobType', job_type_value)
  );

  perform public.write_audit_event(
    'integration.job.enqueued',
    'integration_job',
    job_id_value::text,
    connection_record.organization_id,
    reason_value,
    null,
    jsonb_build_object('connectionId', integration_id_value, 'jobType', job_type_value)
  );

  return job_id_value;
end;
$$;

create or replace function public.retry_integration_job(
  job_id_value uuid,
  reason_value text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  job_record public.integration_jobs%rowtype;
  connection_record public.integrations%rowtype;
begin
  if not public.can_manage_integrations() then
    raise exception 'Integration manager role required';
  end if;

  if char_length(btrim(coalesce(reason_value, ''))) < 5 then
    raise exception 'Reason must contain at least 5 characters';
  end if;

  select * into job_record
  from public.integration_jobs
  where id = job_id_value
  for update;

  if not found then
    raise exception 'Integration job not found';
  end if;

  if job_record.status not in ('failed', 'dead_letter') then
    raise exception 'Only failed or dead-letter jobs can be retried';
  end if;

  select * into connection_record from public.integrations where id = job_record.integration_id;
  if connection_record.status = 'revoked' then
    raise exception 'Connection is revoked';
  end if;

  update public.integration_jobs
  set status = 'queued',
      available_at = now(),
      locked_at = null,
      locked_by = null,
      started_at = null,
      finished_at = null,
      last_error = null
  where id = job_id_value;

  perform public.write_audit_event(
    'integration.job.retried',
    'integration_job',
    job_id_value::text,
    connection_record.organization_id,
    reason_value,
    jsonb_build_object('status', job_record.status),
    jsonb_build_object('status', 'queued')
  );
end;
$$;

create or replace function public.cancel_integration_job(
  job_id_value uuid,
  reason_value text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  job_record public.integration_jobs%rowtype;
  organization_id_value uuid;
begin
  if not public.can_manage_integrations() then
    raise exception 'Integration manager role required';
  end if;

  if char_length(btrim(coalesce(reason_value, ''))) < 5 then
    raise exception 'Reason must contain at least 5 characters';
  end if;

  select * into job_record
  from public.integration_jobs
  where id = job_id_value
  for update;

  if not found then
    raise exception 'Integration job not found';
  end if;

  if job_record.status not in ('queued', 'failed') then
    raise exception 'Only queued or failed jobs can be cancelled';
  end if;

  select organization_id into organization_id_value
  from public.integrations
  where id = job_record.integration_id;

  update public.integration_jobs
  set status = 'cancelled',
      finished_at = now(),
      last_error = btrim(reason_value)
  where id = job_id_value;

  perform public.write_audit_event(
    'integration.job.cancelled',
    'integration_job',
    job_id_value::text,
    organization_id_value,
    reason_value,
    jsonb_build_object('status', job_record.status),
    jsonb_build_object('status', 'cancelled')
  );
end;
$$;

create or replace function public.create_inbound_webhook_endpoint(
  integration_id_value uuid,
  name_value text,
  verification_mode_value text,
  secret_reference_value text,
  signature_header_value text,
  timestamp_header_value text,
  allowed_ip_cidrs_value cidr[],
  allowed_event_types_value text[],
  event_id_path_value text,
  event_type_path_value text,
  challenge_field_value text,
  max_payload_bytes_value integer,
  reason_value text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  connection_record public.integrations%rowtype;
  endpoint_id_value uuid;
  public_key_value text;
  plaintext_token text;
  token_hash_value text;
begin
  if not public.can_manage_integrations() then
    raise exception 'Integration manager role required';
  end if;

  if char_length(btrim(coalesce(name_value, ''))) < 2 then
    raise exception 'Webhook endpoint name is required';
  end if;

  if char_length(btrim(coalesce(reason_value, ''))) < 5 then
    raise exception 'Reason must contain at least 5 characters';
  end if;

  if verification_mode_value not in ('none','hmac_sha256','hmac_sha1','bearer_token','query_token','meta_verify_token') then
    raise exception 'Unsupported verification mode';
  end if;

  select * into connection_record
  from public.integrations
  where id = integration_id_value
    and archived_at is null;

  if not found then
    raise exception 'Integration connection not found';
  end if;

  if verification_mode_value in ('hmac_sha256','hmac_sha1')
     and nullif(btrim(secret_reference_value), '') is null then
    raise exception 'HMAC verification requires a secret reference';
  end if;

  if nullif(btrim(secret_reference_value), '') is not null
     and secret_reference_value !~ '^(env|vault|secret)://[A-Za-z0-9_./:-]+$' then
    raise exception 'Secret reference format is invalid';
  end if;

  public_key_value := 'wh_' || encode(gen_random_bytes(18), 'hex');

  if verification_mode_value in ('bearer_token','query_token','meta_verify_token') then
    plaintext_token := encode(gen_random_bytes(32), 'hex');
    token_hash_value := encode(digest(plaintext_token, 'sha256'), 'hex');
  end if;

  insert into public.inbound_webhook_endpoints (
    integration_id,
    public_key,
    name,
    verification_mode,
    secret_reference,
    token_hash,
    signature_header,
    timestamp_header,
    allowed_ip_cidrs,
    allowed_event_types,
    event_id_path,
    event_type_path,
    challenge_field,
    max_payload_bytes,
    created_by
  ) values (
    integration_id_value,
    public_key_value,
    btrim(name_value),
    verification_mode_value,
    nullif(btrim(secret_reference_value), ''),
    token_hash_value,
    coalesce(nullif(lower(btrim(signature_header_value)), ''), 'x-signature'),
    nullif(lower(btrim(timestamp_header_value)), ''),
    coalesce(allowed_ip_cidrs_value, '{}'::cidr[]),
    coalesce(allowed_event_types_value, '{}'::text[]),
    nullif(btrim(event_id_path_value), ''),
    nullif(btrim(event_type_path_value), ''),
    nullif(btrim(challenge_field_value), ''),
    greatest(1024, least(coalesce(max_payload_bytes_value, 1048576), 10485760)),
    auth.uid()
  ) returning id into endpoint_id_value;

  perform public.write_audit_event(
    'integration.webhook_endpoint.created',
    'inbound_webhook_endpoint',
    endpoint_id_value::text,
    connection_record.organization_id,
    reason_value,
    null,
    jsonb_build_object(
      'integrationId', integration_id_value,
      'publicKey', public_key_value,
      'verificationMode', verification_mode_value
    )
  );

  return jsonb_build_object(
    'endpointId', endpoint_id_value,
    'publicKey', public_key_value,
    'verificationToken', plaintext_token
  );
end;
$$;

create or replace function public.create_outbound_webhook_subscription(
  organization_id_value uuid,
  product_id_value uuid,
  name_value text,
  target_url_value text,
  event_types_value text[],
  secret_reference_value text,
  timeout_ms_value integer,
  max_attempts_value integer,
  headers_value jsonb,
  reason_value text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  subscription_id_value uuid;
begin
  if not public.can_manage_integrations() then
    raise exception 'Integration manager role required';
  end if;

  if char_length(btrim(coalesce(name_value, ''))) < 2 then
    raise exception 'Subscription name is required';
  end if;

  if target_url_value !~ '^https://' then
    raise exception 'Outbound webhook target must use HTTPS';
  end if;

  if cardinality(coalesce(event_types_value, '{}'::text[])) = 0 then
    raise exception 'At least one event type is required';
  end if;

  if organization_id_value is not null and not exists (
    select 1 from public.organizations where id = organization_id_value and status <> 'archived'
  ) then
    raise exception 'Organization is unavailable';
  end if;

  if product_id_value is not null and not exists (
    select 1 from public.products where id = product_id_value and archived_at is null
  ) then
    raise exception 'Product is unavailable';
  end if;

  if nullif(btrim(secret_reference_value), '') is not null
     and secret_reference_value !~ '^(env|vault|secret)://[A-Za-z0-9_./:-]+$' then
    raise exception 'Secret reference format is invalid';
  end if;

  insert into public.outbound_webhook_subscriptions (
    organization_id,
    product_id,
    name,
    target_url,
    event_types,
    secret_reference,
    timeout_ms,
    max_attempts,
    headers,
    created_by
  ) values (
    organization_id_value,
    product_id_value,
    btrim(name_value),
    btrim(target_url_value),
    event_types_value,
    nullif(btrim(secret_reference_value), ''),
    greatest(1000, least(coalesce(timeout_ms_value, 10000), 60000)),
    greatest(1, least(coalesce(max_attempts_value, 8), 50)),
    coalesce(headers_value, '{}'::jsonb),
    auth.uid()
  ) returning id into subscription_id_value;

  perform public.write_audit_event(
    'integration.outbound_subscription.created',
    'outbound_webhook_subscription',
    subscription_id_value::text,
    organization_id_value,
    reason_value,
    null,
    jsonb_build_object('targetUrl', target_url_value, 'eventTypes', event_types_value)
  );

  return subscription_id_value;
end;
$$;

create or replace function public.publish_platform_event(
  organization_id_value uuid,
  product_id_value uuid,
  event_type_value text,
  subject_type_value text,
  subject_id_value text,
  payload_value jsonb,
  idempotency_key_value text,
  correlation_id_value uuid default gen_random_uuid()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  event_id_value uuid;
begin
  if auth.role() <> 'service_role' and not public.is_platform_staff() then
    raise exception 'Platform staff or service role required';
  end if;

  if event_type_value !~ '^[a-z0-9]+([._-][a-z0-9]+)+$' then
    raise exception 'Event type format is invalid';
  end if;

  if char_length(btrim(coalesce(idempotency_key_value, ''))) < 8 then
    raise exception 'Idempotency key is required';
  end if;

  select id into event_id_value
  from public.platform_events
  where idempotency_key = idempotency_key_value;

  if event_id_value is not null then
    return event_id_value;
  end if;

  insert into public.platform_events (
    organization_id,
    product_id,
    event_type,
    subject_type,
    subject_id,
    payload,
    idempotency_key,
    correlation_id
  ) values (
    organization_id_value,
    product_id_value,
    event_type_value,
    nullif(btrim(subject_type_value), ''),
    nullif(btrim(subject_id_value), ''),
    coalesce(payload_value, '{}'::jsonb),
    btrim(idempotency_key_value),
    correlation_id_value
  ) returning id into event_id_value;

  insert into public.outbound_webhook_deliveries (
    subscription_id,
    platform_event_id,
    status,
    idempotency_key,
    max_attempts,
    correlation_id
  )
  select
    subscription.id,
    event_id_value,
    'queued',
    concat_ws(':', 'delivery', subscription.id::text, event_id_value::text),
    subscription.max_attempts,
    correlation_id_value
  from public.outbound_webhook_subscriptions subscription
  where subscription.status = 'active'
    and subscription.archived_at is null
    and event_type_value = any(subscription.event_types)
    and (subscription.organization_id is null or subscription.organization_id = organization_id_value)
    and (subscription.product_id is null or subscription.product_id = product_id_value)
  on conflict (idempotency_key) do nothing;

  return event_id_value;
end;
$$;

create or replace function public.retry_outbound_webhook_delivery(
  delivery_id_value uuid,
  reason_value text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  delivery_record public.outbound_webhook_deliveries%rowtype;
  organization_id_value uuid;
begin
  if not public.can_manage_integrations() then
    raise exception 'Integration manager role required';
  end if;

  if char_length(btrim(coalesce(reason_value, ''))) < 5 then
    raise exception 'Reason must contain at least 5 characters';
  end if;

  select * into delivery_record
  from public.outbound_webhook_deliveries
  where id = delivery_id_value
  for update;

  if not found then
    raise exception 'Webhook delivery not found';
  end if;

  if delivery_record.status not in ('failed', 'dead_letter') then
    raise exception 'Only failed or dead-letter deliveries can be retried';
  end if;

  select subscription.organization_id into organization_id_value
  from public.outbound_webhook_subscriptions subscription
  where subscription.id = delivery_record.subscription_id;

  update public.outbound_webhook_deliveries
  set status = 'queued',
      available_at = now(),
      locked_at = null,
      locked_by = null,
      started_at = null,
      finished_at = null,
      response_status = null,
      response_headers = null,
      response_body = null,
      last_error = null
  where id = delivery_id_value;

  perform public.write_audit_event(
    'integration.outbound_delivery.retried',
    'outbound_webhook_delivery',
    delivery_id_value::text,
    organization_id_value,
    reason_value,
    jsonb_build_object('status', delivery_record.status),
    jsonb_build_object('status', 'queued')
  );
end;
$$;

create or replace function public.create_api_client(
  organization_id_value uuid,
  name_value text,
  scopes_value text[],
  allowed_ip_cidrs_value cidr[],
  rate_limit_per_minute_value integer,
  expires_at_value timestamptz,
  reason_value text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  client_id_value uuid;
  plaintext_key text;
  key_prefix_value text;
  key_hash_value text;
begin
  if not public.can_manage_integrations() then
    raise exception 'Integration manager role required';
  end if;

  if char_length(btrim(coalesce(name_value, ''))) < 2 then
    raise exception 'API client name is required';
  end if;

  if cardinality(coalesce(scopes_value, '{}'::text[])) = 0 then
    raise exception 'At least one scope is required';
  end if;

  if organization_id_value is not null and not exists (
    select 1 from public.organizations where id = organization_id_value and status <> 'archived'
  ) then
    raise exception 'Organization is unavailable';
  end if;

  if expires_at_value is not null and expires_at_value <= now() then
    raise exception 'API client expiration must be in the future';
  end if;

  plaintext_key := 'imds_live_' || encode(gen_random_bytes(32), 'hex');
  key_prefix_value := left(plaintext_key, 18);
  key_hash_value := encode(digest(plaintext_key, 'sha256'), 'hex');

  insert into public.api_clients (
    organization_id,
    name,
    key_prefix,
    key_hash,
    scopes,
    allowed_ip_cidrs,
    rate_limit_per_minute,
    expires_at,
    created_by
  ) values (
    organization_id_value,
    btrim(name_value),
    key_prefix_value,
    key_hash_value,
    scopes_value,
    coalesce(allowed_ip_cidrs_value, '{}'::cidr[]),
    greatest(1, least(coalesce(rate_limit_per_minute_value, 120), 10000)),
    expires_at_value,
    auth.uid()
  ) returning id into client_id_value;

  perform public.write_audit_event(
    'integration.api_client.created',
    'api_client',
    client_id_value::text,
    organization_id_value,
    reason_value,
    null,
    jsonb_build_object(
      'name', name_value,
      'keyPrefix', key_prefix_value,
      'scopes', scopes_value,
      'expiresAt', expires_at_value
    )
  );

  return jsonb_build_object(
    'clientId', client_id_value,
    'apiKey', plaintext_key,
    'keyPrefix', key_prefix_value
  );
end;
$$;

create or replace function public.revoke_api_client(
  api_client_id_value uuid,
  reason_value text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  client_record public.api_clients%rowtype;
begin
  if not public.can_manage_integrations() then
    raise exception 'Integration manager role required';
  end if;

  if char_length(btrim(coalesce(reason_value, ''))) < 5 then
    raise exception 'Reason must contain at least 5 characters';
  end if;

  select * into client_record
  from public.api_clients
  where id = api_client_id_value
  for update;

  if not found then
    raise exception 'API client not found';
  end if;

  if client_record.status = 'revoked' then
    return;
  end if;

  update public.api_clients
  set status = 'revoked',
      revoked_by = auth.uid(),
      revoked_at = now(),
      revoke_reason = btrim(reason_value)
  where id = api_client_id_value;

  perform public.write_audit_event(
    'integration.api_client.revoked',
    'api_client',
    api_client_id_value::text,
    client_record.organization_id,
    reason_value,
    jsonb_build_object('status', client_record.status),
    jsonb_build_object('status', 'revoked')
  );
end;
$$;

revoke all on function public.save_integration_connection(uuid, uuid, uuid, text, text, public.integration_environment, public.integration_auth_type, text, text, text, jsonb, text) from public;
revoke all on function public.set_integration_connection_status(uuid, public.integration_connection_status, text) from public;
revoke all on function public.enqueue_integration_job(uuid, public.integration_job_type, jsonb, text, text) from public;
revoke all on function public.retry_integration_job(uuid, text) from public;
revoke all on function public.cancel_integration_job(uuid, text) from public;
revoke all on function public.create_inbound_webhook_endpoint(uuid, text, text, text, text, text, cidr[], text[], text, text, text, integer, text) from public;
revoke all on function public.create_outbound_webhook_subscription(uuid, uuid, text, text, text[], text, integer, integer, jsonb, text) from public;
revoke all on function public.publish_platform_event(uuid, uuid, text, text, text, jsonb, text, uuid) from public;
revoke all on function public.retry_outbound_webhook_delivery(uuid, text) from public;
revoke all on function public.create_api_client(uuid, text, text[], cidr[], integer, timestamptz, text) from public;
revoke all on function public.revoke_api_client(uuid, text) from public;

grant execute on function public.save_integration_connection(uuid, uuid, uuid, text, text, public.integration_environment, public.integration_auth_type, text, text, text, jsonb, text) to authenticated;
grant execute on function public.set_integration_connection_status(uuid, public.integration_connection_status, text) to authenticated;
grant execute on function public.enqueue_integration_job(uuid, public.integration_job_type, jsonb, text, text) to authenticated;
grant execute on function public.retry_integration_job(uuid, text) to authenticated;
grant execute on function public.cancel_integration_job(uuid, text) to authenticated;
grant execute on function public.create_inbound_webhook_endpoint(uuid, text, text, text, text, text, cidr[], text[], text, text, text, integer, text) to authenticated;
grant execute on function public.create_outbound_webhook_subscription(uuid, uuid, text, text, text[], text, integer, integer, jsonb, text) to authenticated;
grant execute on function public.publish_platform_event(uuid, uuid, text, text, text, jsonb, text, uuid) to authenticated, service_role;
grant execute on function public.retry_outbound_webhook_delivery(uuid, text) to authenticated;
grant execute on function public.create_api_client(uuid, text, text[], cidr[], integer, timestamptz, text) to authenticated;
grant execute on function public.revoke_api_client(uuid, text) to authenticated;

alter table public.integration_providers enable row level security;
alter table public.integration_connection_events enable row level security;
alter table public.inbound_webhook_endpoints enable row level security;
alter table public.inbound_webhook_events enable row level security;
alter table public.integration_jobs enable row level security;
alter table public.outbound_webhook_subscriptions enable row level security;
alter table public.platform_events enable row level security;
alter table public.outbound_webhook_deliveries enable row level security;
alter table public.api_clients enable row level security;
alter table public.api_rate_limit_buckets enable row level security;
alter table public.api_request_logs enable row level security;

drop policy if exists integrations_platform_staff_select on public.integrations;
create policy integrations_platform_staff_select
on public.integrations for select
to authenticated
using (public.is_platform_staff());

create policy integration_providers_platform_staff_select
on public.integration_providers for select
to authenticated
using (public.is_platform_staff());

create policy integration_connection_events_platform_staff_select
on public.integration_connection_events for select
to authenticated
using (public.is_platform_staff());

create policy inbound_webhook_endpoints_platform_staff_select
on public.inbound_webhook_endpoints for select
to authenticated
using (public.is_platform_staff());

create policy inbound_webhook_events_platform_staff_select
on public.inbound_webhook_events for select
to authenticated
using (public.is_platform_staff());

create policy integration_jobs_platform_staff_select
on public.integration_jobs for select
to authenticated
using (public.is_platform_staff());

create policy outbound_webhook_subscriptions_platform_staff_select
on public.outbound_webhook_subscriptions for select
to authenticated
using (public.is_platform_staff());

create policy platform_events_platform_staff_select
on public.platform_events for select
to authenticated
using (public.is_platform_staff());

create policy outbound_webhook_deliveries_platform_staff_select
on public.outbound_webhook_deliveries for select
to authenticated
using (public.is_platform_staff());

create policy api_clients_platform_staff_select
on public.api_clients for select
to authenticated
using (public.is_platform_staff());

create policy api_request_logs_platform_staff_select
on public.api_request_logs for select
to authenticated
using (public.is_platform_staff());

revoke insert, update, delete on public.integration_providers from authenticated;
revoke insert, update, delete on public.integrations from authenticated;
revoke insert, update, delete on public.integration_connection_events from authenticated;
revoke insert, update, delete on public.inbound_webhook_endpoints from authenticated;
revoke insert, update, delete on public.inbound_webhook_events from authenticated;
revoke insert, update, delete on public.integration_jobs from authenticated;
revoke insert, update, delete on public.outbound_webhook_subscriptions from authenticated;
revoke insert, update, delete on public.platform_events from authenticated;
revoke insert, update, delete on public.outbound_webhook_deliveries from authenticated;
revoke insert, update, delete on public.api_clients from authenticated;
revoke insert, update, delete on public.api_rate_limit_buckets from authenticated;
revoke insert, update, delete on public.api_request_logs from authenticated;

grant select on public.integration_providers to authenticated;
grant select on public.integrations to authenticated;
grant select on public.integration_connection_events to authenticated;
grant select on public.inbound_webhook_endpoints to authenticated;
grant select on public.inbound_webhook_events to authenticated;
grant select on public.integration_jobs to authenticated;
grant select on public.outbound_webhook_subscriptions to authenticated;
grant select on public.platform_events to authenticated;
grant select on public.outbound_webhook_deliveries to authenticated;
grant select on public.api_clients to authenticated;
grant select on public.api_request_logs to authenticated;

comment on table public.integration_providers is
  'Platform catalogue of external systems and supported capabilities.';
comment on table public.integrations is
  'Tenant-scoped connection metadata. Credentials are stored only as external secret references.';
comment on table public.inbound_webhook_events is
  'Durable inbound event store with signature result, deduplication and processing state.';
comment on table public.outbound_webhook_deliveries is
  'Durable outbound delivery queue with retries and dead-letter state.';
comment on table public.api_clients is
  'Hashed machine credentials. Plaintext API keys are returned only once at creation.';
