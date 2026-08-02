-- Product analytics, live presence and usage metering for the IMDS product ecosystem.
-- Checkmate remains responsible for external uptime and infrastructure monitoring.
-- This schema stores operational product-usage telemetry only. Medical records, diagnoses,
-- patient notes, phone numbers, access tokens and arbitrary form payloads are prohibited.

create type public.telemetry_source_status as enum (
  'draft',
  'active',
  'disabled',
  'compromised'
);

create type public.telemetry_source_type as enum (
  'browser',
  'server'
);

create type public.product_usage_session_status as enum (
  'active',
  'idle',
  'offline',
  'closed'
);

create type public.product_usage_event_category as enum (
  'session',
  'navigation',
  'feature',
  'business',
  'error',
  'performance',
  'system'
);

create type public.product_usage_outcome as enum (
  'neutral',
  'success',
  'failure'
);

create table public.telemetry_sources (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  source_key text not null unique,
  name text not null,
  source_type public.telemetry_source_type not null default 'browser',
  environment public.product_endpoint_environment not null default 'production',
  write_key_hash text not null,
  allowed_origins text[] not null default '{}'::text[],
  status public.telemetry_source_status not null default 'draft',
  sample_rate numeric(5,4) not null default 1.0000 check (sample_rate >= 0 and sample_rate <= 1),
  heartbeat_interval_seconds integer not null default 30 check (heartbeat_interval_seconds between 15 and 300),
  idle_timeout_seconds integer not null default 120 check (idle_timeout_seconds between 30 and 3600),
  session_timeout_seconds integer not null default 1800 check (session_timeout_seconds between 60 and 86400),
  retention_days integer not null default 90 check (retention_days between 7 and 730),
  last_event_at timestamptz,
  last_error text,
  config jsonb not null default '{}'::jsonb,
  created_by uuid references public.platform_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  check (char_length(btrim(name)) between 2 and 120),
  check (write_key_hash ~ '^[a-f0-9]{64}$'),
  check (source_type = 'server' or cardinality(allowed_origins) > 0),
  check (session_timeout_seconds > idle_timeout_seconds)
);

create table public.telemetry_event_definitions (
  event_name text primary key,
  category public.product_usage_event_category not null,
  display_name text not null,
  description text,
  counts_toward_usage boolean not null default true,
  contains_business_data boolean not null default false,
  allowed_property_keys text[] not null default '{}'::text[],
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (event_name ~ '^[a-z][a-z0-9_]{1,79}$'),
  check (char_length(btrim(display_name)) between 2 and 120)
);

create table public.product_usage_sessions (
  id uuid primary key,
  source_id uuid not null references public.telemetry_sources(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  module_owner_product_id uuid references public.products(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete set null,
  organization_key text,
  branch_id uuid references public.branches(id) on delete set null,
  branch_key text,
  user_key text,
  user_label text,
  user_role text,
  status public.product_usage_session_status not null default 'active',
  started_at timestamptz not null,
  last_seen_at timestamptz not null,
  last_activity_at timestamptz,
  ended_at timestamptz,
  active_seconds bigint not null default 0 check (active_seconds >= 0),
  idle_seconds bigint not null default 0 check (idle_seconds >= 0),
  current_route text,
  current_module_key text,
  current_module_name text,
  app_version text,
  sdk_version text,
  device_type text,
  browser text,
  operating_system text,
  timezone text,
  is_tab_visible boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at),
  check (last_seen_at >= started_at),
  check (last_activity_at is null or last_activity_at >= started_at),
  check (user_key is null or char_length(user_key) between 1 and 160),
  check (user_label is null or char_length(user_label) <= 160),
  check (current_route is null or char_length(current_route) <= 500),
  check (current_module_key is null or current_module_key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$')
);

create table public.product_usage_events (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.telemetry_sources(id) on delete cascade,
  event_id uuid not null,
  session_id uuid references public.product_usage_sessions(id) on delete set null,
  product_id uuid not null references public.products(id) on delete cascade,
  module_owner_product_id uuid references public.products(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete set null,
  organization_key text,
  branch_id uuid references public.branches(id) on delete set null,
  branch_key text,
  user_key text,
  user_label text,
  event_name text not null,
  category public.product_usage_event_category not null,
  outcome public.product_usage_outcome not null default 'neutral',
  route text,
  module_key text,
  module_name text,
  feature_key text,
  duration_ms integer check (duration_ms is null or duration_ms between 0 and 86400000),
  active_seconds_delta integer not null default 0 check (active_seconds_delta between 0 and 300),
  idle_seconds_delta integer not null default 0 check (idle_seconds_delta between 0 and 1800),
  properties jsonb not null default '{}'::jsonb,
  app_version text,
  sdk_version text,
  occurred_at timestamptz not null,
  occurred_on date not null,
  received_at timestamptz not null default now(),
  unique (source_id, event_id),
  check (event_name ~ '^[a-z][a-z0-9_]{1,79}$'),
  check (route is null or char_length(route) <= 500),
  check (module_key is null or module_key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  check (feature_key is null or feature_key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  check (jsonb_typeof(properties) = 'object')
);

create table public.product_usage_daily_rollups (
  id bigint generated by default as identity primary key,
  rollup_date date not null,
  product_id uuid not null references public.products(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  organization_key text not null default '',
  module_owner_product_id uuid references public.products(id) on delete set null,
  module_key text not null default '',
  feature_key text not null default '',
  event_name text not null default '',
  unique_users integer not null default 0 check (unique_users >= 0),
  sessions integer not null default 0 check (sessions >= 0),
  event_count bigint not null default 0 check (event_count >= 0),
  active_seconds bigint not null default 0 check (active_seconds >= 0),
  idle_seconds bigint not null default 0 check (idle_seconds >= 0),
  success_count bigint not null default 0 check (success_count >= 0),
  failure_count bigint not null default 0 check (failure_count >= 0),
  error_count bigint not null default 0 check (error_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.telemetry_ingestion_batches (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  source_id uuid not null references public.telemetry_sources(id) on delete cascade,
  origin text,
  sdk_version text,
  event_count integer not null default 0 check (event_count between 0 and 100),
  accepted_count integer not null default 0 check (accepted_count >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  rejected_count integer not null default 0 check (rejected_count >= 0),
  processing_ms integer check (processing_ms is null or processing_ms >= 0),
  errors jsonb not null default '[]'::jsonb,
  request_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(errors) = 'array'),
  check (jsonb_typeof(request_metadata) = 'object')
);

create index telemetry_sources_product_environment_idx
  on public.telemetry_sources(product_id, environment, status);
create index product_usage_sessions_live_idx
  on public.product_usage_sessions(last_seen_at desc, status)
  where ended_at is null;
create index product_usage_sessions_product_time_idx
  on public.product_usage_sessions(product_id, started_at desc);
create index product_usage_sessions_org_time_idx
  on public.product_usage_sessions(organization_id, started_at desc);
create index product_usage_sessions_user_time_idx
  on public.product_usage_sessions(user_key, started_at desc)
  where user_key is not null;
create index product_usage_events_product_time_idx
  on public.product_usage_events(product_id, occurred_at desc);
create index product_usage_events_org_time_idx
  on public.product_usage_events(organization_id, occurred_at desc);
create index product_usage_events_name_time_idx
  on public.product_usage_events(event_name, occurred_at desc);
create index product_usage_events_feature_time_idx
  on public.product_usage_events(module_key, feature_key, occurred_at desc)
  where module_key is not null or feature_key is not null;
create index product_usage_events_session_idx
  on public.product_usage_events(session_id, occurred_at)
  where session_id is not null;
create index product_usage_events_retention_idx
  on public.product_usage_events(source_id, occurred_at);
create index product_usage_rollups_date_product_idx
  on public.product_usage_daily_rollups(rollup_date desc, product_id);
create index product_usage_rollups_org_date_idx
  on public.product_usage_daily_rollups(organization_id, rollup_date desc);
create index telemetry_batches_source_time_idx
  on public.telemetry_ingestion_batches(source_id, created_at desc);

create trigger telemetry_sources_set_updated_at
before update on public.telemetry_sources
for each row execute function public.set_updated_at();

create trigger telemetry_event_definitions_set_updated_at
before update on public.telemetry_event_definitions
for each row execute function public.set_updated_at();

create trigger product_usage_sessions_set_updated_at
before update on public.product_usage_sessions
for each row execute function public.set_updated_at();

create trigger product_usage_daily_rollups_set_updated_at
before update on public.product_usage_daily_rollups
for each row execute function public.set_updated_at();

insert into public.telemetry_event_definitions (
  event_name,
  category,
  display_name,
  description,
  counts_toward_usage,
  allowed_property_keys
) values
  ('session_started', 'session', 'Session started', 'A new application session was opened.', false, '{}'),
  ('session_heartbeat', 'session', 'Session heartbeat', 'Periodic presence and active-time update.', false, '{}'),
  ('session_ended', 'session', 'Session ended', 'A session was explicitly closed or timed out.', false, '{}'),
  ('page_viewed', 'navigation', 'Page viewed', 'A named product route was displayed.', true, array['referrer']),
  ('module_opened', 'navigation', 'Module opened', 'A product module was opened.', true, '{}'),
  ('feature_used', 'feature', 'Feature used', 'A named product feature was used.', true, array['action']),
  ('entity_created', 'business', 'Entity created', 'A non-sensitive business entity was created.', true, array['entityType']),
  ('entity_updated', 'business', 'Entity updated', 'A non-sensitive business entity was updated.', true, array['entityType']),
  ('search_performed', 'feature', 'Search performed', 'A product search was executed. Query text must not be sent.', true, array['resultCount']),
  ('export_started', 'feature', 'Export started', 'A report or data export was started.', true, array['format']),
  ('export_completed', 'feature', 'Export completed', 'A report or data export completed.', true, array['format','rowCount']),
  ('api_request', 'performance', 'API request', 'A backend request measurement without request or response payloads.', false, array['method','statusCode']),
  ('api_error', 'error', 'API error', 'A backend error without stack secrets or payload data.', false, array['method','statusCode','errorCode']),
  ('frontend_error', 'error', 'Frontend error', 'A sanitized browser error.', false, array['errorCode','component']),
  ('permission_denied', 'system', 'Permission denied', 'An authorization check denied an action.', false, array['permission']),
  ('subscription_limit_reached', 'system', 'Subscription limit reached', 'A product entitlement limit prevented an action.', true, array['limitKey'])
on conflict (event_name) do nothing;

create or replace function public.can_manage_product_analytics()
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

revoke all on function public.can_manage_product_analytics() from public;
grant execute on function public.can_manage_product_analytics() to authenticated;

create or replace function public.configure_telemetry_source(
  target_source_id uuid,
  product_id_value uuid,
  source_key_value text,
  source_name_value text,
  source_type_value public.telemetry_source_type,
  environment_value public.product_endpoint_environment,
  write_key_hash_value text,
  allowed_origins_value text[],
  status_value public.telemetry_source_status default 'active',
  sample_rate_value numeric default 1,
  heartbeat_interval_seconds_value integer default 30,
  idle_timeout_seconds_value integer default 120,
  session_timeout_seconds_value integer default 1800,
  retention_days_value integer default 90,
  config_value jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  source_id_value uuid;
  normalized_key text;
  normalized_name text;
  normalized_hash text;
  normalized_origins text[];
  before_record jsonb;
  origin_value text;
begin
  if not public.can_manage_product_analytics() then
    raise exception 'Insufficient permission to configure telemetry';
  end if;

  if not exists (
    select 1
    from public.products
    where id = product_id_value
      and archived_at is null
      and status <> 'disabled'
  ) then
    raise exception 'Product is unavailable';
  end if;

  normalized_key := lower(nullif(btrim(source_key_value), ''));
  normalized_name := nullif(btrim(source_name_value), '');
  normalized_hash := lower(nullif(btrim(write_key_hash_value), ''));

  if normalized_key is null or normalized_key !~ '^[a-z0-9]+([._-][a-z0-9]+)*$' then
    raise exception 'Telemetry source key is invalid';
  end if;
  if normalized_name is null or char_length(normalized_name) > 120 then
    raise exception 'Telemetry source name is invalid';
  end if;
  if target_source_id is null and (normalized_hash is null or normalized_hash !~ '^[a-f0-9]{64}$') then
    raise exception 'A SHA-256 write key hash is required';
  end if;
  if normalized_hash is not null and normalized_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Write key hash must be lowercase SHA-256 hex';
  end if;
  if sample_rate_value < 0 or sample_rate_value > 1 then
    raise exception 'Sample rate must be between 0 and 1';
  end if;
  if heartbeat_interval_seconds_value < 15 or heartbeat_interval_seconds_value > 300 then
    raise exception 'Heartbeat interval is outside the allowed range';
  end if;
  if idle_timeout_seconds_value < 30 or idle_timeout_seconds_value > 3600 then
    raise exception 'Idle timeout is outside the allowed range';
  end if;
  if session_timeout_seconds_value <= idle_timeout_seconds_value or session_timeout_seconds_value > 86400 then
    raise exception 'Session timeout must be greater than idle timeout';
  end if;
  if retention_days_value < 7 or retention_days_value > 730 then
    raise exception 'Retention must be between 7 and 730 days';
  end if;

  select coalesce(array_agg(distinct lower(rtrim(btrim(item), '/'))) filter (where btrim(item) <> ''), '{}'::text[])
  into normalized_origins
  from unnest(coalesce(allowed_origins_value, '{}'::text[])) item;

  if source_type_value = 'browser' and cardinality(normalized_origins) = 0 then
    raise exception 'Browser telemetry requires at least one allowed origin';
  end if;

  if source_type_value = 'browser' and environment_value = 'production' then
    foreach origin_value in array normalized_origins loop
      if origin_value = '*' or origin_value !~ '^https://' then
        raise exception 'Production browser origins must be explicit HTTPS origins';
      end if;
    end loop;
  end if;

  if target_source_id is null then
    insert into public.telemetry_sources (
      product_id,
      source_key,
      name,
      source_type,
      environment,
      write_key_hash,
      allowed_origins,
      status,
      sample_rate,
      heartbeat_interval_seconds,
      idle_timeout_seconds,
      session_timeout_seconds,
      retention_days,
      config,
      created_by
    ) values (
      product_id_value,
      normalized_key,
      normalized_name,
      source_type_value,
      environment_value,
      normalized_hash,
      normalized_origins,
      status_value,
      sample_rate_value,
      heartbeat_interval_seconds_value,
      idle_timeout_seconds_value,
      session_timeout_seconds_value,
      retention_days_value,
      coalesce(config_value, '{}'::jsonb),
      auth.uid()
    )
    returning id into source_id_value;
  else
    select to_jsonb(source) into before_record
    from public.telemetry_sources source
    where source.id = target_source_id;

    if before_record is null then
      raise exception 'Telemetry source not found';
    end if;

    update public.telemetry_sources
    set product_id = product_id_value,
        source_key = normalized_key,
        name = normalized_name,
        source_type = source_type_value,
        environment = environment_value,
        write_key_hash = coalesce(normalized_hash, write_key_hash),
        allowed_origins = normalized_origins,
        status = status_value,
        sample_rate = sample_rate_value,
        heartbeat_interval_seconds = heartbeat_interval_seconds_value,
        idle_timeout_seconds = idle_timeout_seconds_value,
        session_timeout_seconds = session_timeout_seconds_value,
        retention_days = retention_days_value,
        config = coalesce(config_value, '{}'::jsonb),
        last_error = case when status_value = 'active' then null else last_error end
    where id = target_source_id
    returning id into source_id_value;
  end if;

  perform public.write_audit_event(
    case when target_source_id is null then 'analytics.telemetry_source.created' else 'analytics.telemetry_source.updated' end,
    'telemetry_source',
    source_id_value::text,
    null,
    'Product telemetry source configuration',
    case when before_record is null then null else before_record - 'write_key_hash' end,
    (
      select to_jsonb(source) - 'write_key_hash' || jsonb_build_object('hasWriteKey', true)
      from public.telemetry_sources source
      where source.id = source_id_value
    )
  );

  return source_id_value;
end;
$$;

revoke all on function public.configure_telemetry_source(
  uuid,
  uuid,
  text,
  text,
  public.telemetry_source_type,
  public.product_endpoint_environment,
  text,
  text[],
  public.telemetry_source_status,
  numeric,
  integer,
  integer,
  integer,
  integer,
  jsonb
) from public;
grant execute on function public.configure_telemetry_source(
  uuid,
  uuid,
  text,
  text,
  public.telemetry_source_type,
  public.product_endpoint_environment,
  text,
  text[],
  public.telemetry_source_status,
  numeric,
  integer,
  integer,
  integer,
  integer,
  jsonb
) to authenticated;

create or replace function public.ingest_product_telemetry_batch(
  target_source_id uuid,
  request_id_value uuid,
  events_value jsonb,
  origin_value text default null,
  sdk_version_value text default null,
  processing_ms_value integer default null,
  request_metadata_value jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  source_record public.telemetry_sources%rowtype;
  existing_batch public.telemetry_ingestion_batches%rowtype;
  event_value jsonb;
  event_id_value uuid;
  session_id_value uuid;
  inserted_event_id uuid;
  occurred_at_value timestamptz;
  session_started_at_value timestamptz;
  last_activity_at_value timestamptz;
  presence_status_value public.product_usage_session_status;
  category_value public.product_usage_event_category;
  outcome_value public.product_usage_outcome;
  organization_id_value uuid;
  branch_id_value uuid;
  module_owner_product_id_value uuid;
  active_delta_value integer;
  idle_delta_value integer;
  accepted_value integer := 0;
  duplicate_value integer := 0;
  total_value integer;
begin
  select * into source_record
  from public.telemetry_sources
  where id = target_source_id
    and status = 'active'
  for update;

  if not found then
    raise exception 'Telemetry source is not active';
  end if;

  select * into existing_batch
  from public.telemetry_ingestion_batches
  where request_id = request_id_value;

  if found then
    return jsonb_build_object(
      'requestId', existing_batch.request_id,
      'accepted', existing_batch.accepted_count,
      'duplicates', existing_batch.duplicate_count,
      'rejected', existing_batch.rejected_count,
      'idempotentReplay', true
    );
  end if;

  if jsonb_typeof(events_value) <> 'array' then
    raise exception 'Telemetry events must be a JSON array';
  end if;

  total_value := jsonb_array_length(events_value);
  if total_value < 1 or total_value > 100 then
    raise exception 'Telemetry batch must contain between 1 and 100 events';
  end if;

  for event_value in select value from jsonb_array_elements(events_value) loop
    event_id_value := (event_value ->> 'eventId')::uuid;
    session_id_value := nullif(event_value ->> 'sessionId', '')::uuid;
    occurred_at_value := (event_value ->> 'occurredAt')::timestamptz;
    session_started_at_value := coalesce(nullif(event_value ->> 'sessionStartedAt', '')::timestamptz, occurred_at_value);
    last_activity_at_value := nullif(event_value ->> 'lastActivityAt', '')::timestamptz;
    presence_status_value := coalesce(nullif(event_value ->> 'presenceStatus', '')::public.product_usage_session_status, 'active');
    category_value := (event_value ->> 'category')::public.product_usage_event_category;
    outcome_value := coalesce(nullif(event_value ->> 'outcome', '')::public.product_usage_outcome, 'neutral');
    organization_id_value := nullif(event_value ->> 'organizationId', '')::uuid;
    branch_id_value := nullif(event_value ->> 'branchId', '')::uuid;
    module_owner_product_id_value := nullif(event_value ->> 'moduleOwnerProductId', '')::uuid;
    active_delta_value := least(greatest(coalesce((event_value ->> 'activeSecondsDelta')::integer, 0), 0), 300);
    idle_delta_value := least(greatest(coalesce((event_value ->> 'idleSecondsDelta')::integer, 0), 0), 1800);

    if occurred_at_value < now() - interval '7 days' or occurred_at_value > now() + interval '10 minutes' then
      raise exception 'Telemetry event timestamp is outside the accepted window';
    end if;

    if session_id_value is not null then
      if exists (
        select 1
        from public.product_usage_sessions
        where id = session_id_value
          and source_id <> target_source_id
      ) then
        raise exception 'Session identifier belongs to another telemetry source';
      end if;

      insert into public.product_usage_sessions (
        id,
        source_id,
        product_id,
        module_owner_product_id,
        organization_id,
        organization_key,
        branch_id,
        branch_key,
        user_key,
        user_label,
        user_role,
        status,
        started_at,
        last_seen_at,
        last_activity_at,
        ended_at,
        current_route,
        current_module_key,
        current_module_name,
        app_version,
        sdk_version,
        device_type,
        browser,
        operating_system,
        timezone,
        is_tab_visible,
        metadata
      ) values (
        session_id_value,
        target_source_id,
        source_record.product_id,
        module_owner_product_id_value,
        organization_id_value,
        nullif(event_value ->> 'organizationKey', ''),
        branch_id_value,
        nullif(event_value ->> 'branchKey', ''),
        nullif(event_value ->> 'userKey', ''),
        nullif(event_value ->> 'userLabel', ''),
        nullif(event_value ->> 'userRole', ''),
        presence_status_value,
        session_started_at_value,
        occurred_at_value,
        last_activity_at_value,
        case when presence_status_value = 'closed' then occurred_at_value else null end,
        nullif(event_value ->> 'route', ''),
        nullif(event_value ->> 'moduleKey', ''),
        nullif(event_value ->> 'moduleName', ''),
        nullif(event_value ->> 'appVersion', ''),
        coalesce(nullif(event_value ->> 'sdkVersion', ''), sdk_version_value),
        nullif(event_value ->> 'deviceType', ''),
        nullif(event_value ->> 'browser', ''),
        nullif(event_value ->> 'operatingSystem', ''),
        nullif(event_value ->> 'timezone', ''),
        coalesce((event_value ->> 'tabVisible')::boolean, true),
        coalesce(event_value -> 'sessionMetadata', '{}'::jsonb)
      )
      on conflict (id) do update
      set module_owner_product_id = coalesce(excluded.module_owner_product_id, product_usage_sessions.module_owner_product_id),
          organization_id = coalesce(excluded.organization_id, product_usage_sessions.organization_id),
          organization_key = coalesce(excluded.organization_key, product_usage_sessions.organization_key),
          branch_id = coalesce(excluded.branch_id, product_usage_sessions.branch_id),
          branch_key = coalesce(excluded.branch_key, product_usage_sessions.branch_key),
          user_key = coalesce(excluded.user_key, product_usage_sessions.user_key),
          user_label = coalesce(excluded.user_label, product_usage_sessions.user_label),
          user_role = coalesce(excluded.user_role, product_usage_sessions.user_role),
          status = excluded.status,
          last_seen_at = greatest(product_usage_sessions.last_seen_at, excluded.last_seen_at),
          last_activity_at = case
            when product_usage_sessions.last_activity_at is null then excluded.last_activity_at
            when excluded.last_activity_at is null then product_usage_sessions.last_activity_at
            else greatest(product_usage_sessions.last_activity_at, excluded.last_activity_at)
          end,
          ended_at = coalesce(excluded.ended_at, product_usage_sessions.ended_at),
          current_route = coalesce(excluded.current_route, product_usage_sessions.current_route),
          current_module_key = coalesce(excluded.current_module_key, product_usage_sessions.current_module_key),
          current_module_name = coalesce(excluded.current_module_name, product_usage_sessions.current_module_name),
          app_version = coalesce(excluded.app_version, product_usage_sessions.app_version),
          sdk_version = coalesce(excluded.sdk_version, product_usage_sessions.sdk_version),
          device_type = coalesce(excluded.device_type, product_usage_sessions.device_type),
          browser = coalesce(excluded.browser, product_usage_sessions.browser),
          operating_system = coalesce(excluded.operating_system, product_usage_sessions.operating_system),
          timezone = coalesce(excluded.timezone, product_usage_sessions.timezone),
          is_tab_visible = excluded.is_tab_visible,
          metadata = product_usage_sessions.metadata || excluded.metadata;
    end if;

    inserted_event_id := null;
    insert into public.product_usage_events (
      source_id,
      event_id,
      session_id,
      product_id,
      module_owner_product_id,
      organization_id,
      organization_key,
      branch_id,
      branch_key,
      user_key,
      user_label,
      event_name,
      category,
      outcome,
      route,
      module_key,
      module_name,
      feature_key,
      duration_ms,
      active_seconds_delta,
      idle_seconds_delta,
      properties,
      app_version,
      sdk_version,
      occurred_at,
      occurred_on
    ) values (
      target_source_id,
      event_id_value,
      session_id_value,
      source_record.product_id,
      module_owner_product_id_value,
      organization_id_value,
      nullif(event_value ->> 'organizationKey', ''),
      branch_id_value,
      nullif(event_value ->> 'branchKey', ''),
      nullif(event_value ->> 'userKey', ''),
      nullif(event_value ->> 'userLabel', ''),
      event_value ->> 'eventName',
      category_value,
      outcome_value,
      nullif(event_value ->> 'route', ''),
      nullif(event_value ->> 'moduleKey', ''),
      nullif(event_value ->> 'moduleName', ''),
      nullif(event_value ->> 'featureKey', ''),
      nullif(event_value ->> 'durationMs', '')::integer,
      active_delta_value,
      idle_delta_value,
      coalesce(event_value -> 'properties', '{}'::jsonb),
      nullif(event_value ->> 'appVersion', ''),
      coalesce(nullif(event_value ->> 'sdkVersion', ''), sdk_version_value),
      occurred_at_value,
      (occurred_at_value at time zone 'UTC')::date
    )
    on conflict (source_id, event_id) do nothing
    returning id into inserted_event_id;

    if inserted_event_id is null then
      duplicate_value := duplicate_value + 1;
    else
      accepted_value := accepted_value + 1;
      if session_id_value is not null then
        update public.product_usage_sessions
        set active_seconds = active_seconds + active_delta_value,
            idle_seconds = idle_seconds + idle_delta_value
        where id = session_id_value
          and source_id = target_source_id;
      end if;
    end if;
  end loop;

  insert into public.telemetry_ingestion_batches (
    request_id,
    source_id,
    origin,
    sdk_version,
    event_count,
    accepted_count,
    duplicate_count,
    rejected_count,
    processing_ms,
    request_metadata
  ) values (
    request_id_value,
    target_source_id,
    nullif(origin_value, ''),
    nullif(sdk_version_value, ''),
    total_value,
    accepted_value,
    duplicate_value,
    0,
    processing_ms_value,
    coalesce(request_metadata_value, '{}'::jsonb)
  );

  update public.telemetry_sources
  set last_event_at = now(),
      last_error = null
  where id = target_source_id;

  return jsonb_build_object(
    'requestId', request_id_value,
    'accepted', accepted_value,
    'duplicates', duplicate_value,
    'rejected', 0,
    'idempotentReplay', false
  );
end;
$$;

revoke all on function public.ingest_product_telemetry_batch(uuid, uuid, jsonb, text, text, integer, jsonb) from public;
grant execute on function public.ingest_product_telemetry_batch(uuid, uuid, jsonb, text, text, integer, jsonb) to service_role;

create or replace function public.record_failed_telemetry_batch(
  target_source_id uuid,
  request_id_value uuid,
  origin_value text,
  sdk_version_value text,
  event_count_value integer,
  processing_ms_value integer,
  errors_value jsonb,
  request_metadata_value jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.telemetry_ingestion_batches (
    request_id,
    source_id,
    origin,
    sdk_version,
    event_count,
    accepted_count,
    duplicate_count,
    rejected_count,
    processing_ms,
    errors,
    request_metadata
  ) values (
    request_id_value,
    target_source_id,
    nullif(origin_value, ''),
    nullif(sdk_version_value, ''),
    least(greatest(coalesce(event_count_value, 0), 0), 100),
    0,
    0,
    least(greatest(coalesce(event_count_value, 0), 0), 100),
    processing_ms_value,
    case when jsonb_typeof(errors_value) = 'array' then errors_value else jsonb_build_array(errors_value) end,
    coalesce(request_metadata_value, '{}'::jsonb)
  )
  on conflict (request_id) do nothing;

  update public.telemetry_sources
  set last_error = left(coalesce(errors_value::text, 'Telemetry batch failed'), 1000)
  where id = target_source_id;
end;
$$;

revoke all on function public.record_failed_telemetry_batch(uuid, uuid, text, text, integer, integer, jsonb, jsonb) from public;
grant execute on function public.record_failed_telemetry_batch(uuid, uuid, text, text, integer, integer, jsonb, jsonb) to service_role;

create or replace function public.expire_stale_product_usage_sessions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  changed_value integer := 0;
  row_count_value integer;
begin
  update public.product_usage_sessions session
  set status = 'closed',
      ended_at = coalesce(session.ended_at, session.last_seen_at)
  from public.telemetry_sources source
  where source.id = session.source_id
    and session.status <> 'closed'
    and session.last_seen_at < now() - make_interval(secs => source.session_timeout_seconds);
  get diagnostics row_count_value = row_count;
  changed_value := changed_value + row_count_value;

  update public.product_usage_sessions session
  set status = 'idle'
  from public.telemetry_sources source
  where source.id = session.source_id
    and session.status = 'active'
    and session.last_activity_at is not null
    and session.last_activity_at < now() - make_interval(secs => source.idle_timeout_seconds)
    and session.last_seen_at >= now() - make_interval(secs => source.session_timeout_seconds);
  get diagnostics row_count_value = row_count;
  changed_value := changed_value + row_count_value;

  return changed_value;
end;
$$;

revoke all on function public.expire_stale_product_usage_sessions() from public;
grant execute on function public.expire_stale_product_usage_sessions() to service_role;

create or replace function public.refresh_product_usage_rollups(target_date date default current_date - 1)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_value integer;
begin
  delete from public.product_usage_daily_rollups
  where rollup_date = target_date;

  insert into public.product_usage_daily_rollups (
    rollup_date,
    product_id,
    organization_id,
    organization_key,
    module_owner_product_id,
    module_key,
    feature_key,
    event_name,
    unique_users,
    sessions,
    event_count,
    active_seconds,
    idle_seconds,
    success_count,
    failure_count,
    error_count
  )
  select
    event.occurred_on,
    event.product_id,
    event.organization_id,
    coalesce(event.organization_key, ''),
    event.module_owner_product_id,
    coalesce(event.module_key, ''),
    coalesce(event.feature_key, ''),
    event.event_name,
    count(distinct event.user_key) filter (where event.user_key is not null)::integer,
    count(distinct event.session_id) filter (where event.session_id is not null)::integer,
    count(*)::bigint,
    coalesce(sum(event.active_seconds_delta), 0)::bigint,
    coalesce(sum(event.idle_seconds_delta), 0)::bigint,
    count(*) filter (where event.outcome = 'success')::bigint,
    count(*) filter (where event.outcome = 'failure')::bigint,
    count(*) filter (where event.category = 'error' or event.outcome = 'failure')::bigint
  from public.product_usage_events event
  where event.occurred_on = target_date
  group by
    event.occurred_on,
    event.product_id,
    event.organization_id,
    coalesce(event.organization_key, ''),
    event.module_owner_product_id,
    coalesce(event.module_key, ''),
    coalesce(event.feature_key, ''),
    event.event_name;

  get diagnostics inserted_value = row_count;
  return inserted_value;
end;
$$;

revoke all on function public.refresh_product_usage_rollups(date) from public;
grant execute on function public.refresh_product_usage_rollups(date) to service_role;

create or replace function public.purge_expired_product_usage_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  events_deleted integer;
  batches_deleted integer;
  sessions_deleted integer;
begin
  delete from public.product_usage_events event
  using public.telemetry_sources source
  where source.id = event.source_id
    and event.occurred_at < now() - make_interval(days => source.retention_days);
  get diagnostics events_deleted = row_count;

  delete from public.telemetry_ingestion_batches batch
  using public.telemetry_sources source
  where source.id = batch.source_id
    and batch.created_at < now() - make_interval(days => greatest(source.retention_days, 30));
  get diagnostics batches_deleted = row_count;

  delete from public.product_usage_sessions session
  using public.telemetry_sources source
  where source.id = session.source_id
    and session.status = 'closed'
    and coalesce(session.ended_at, session.last_seen_at) < now() - make_interval(days => source.retention_days);
  get diagnostics sessions_deleted = row_count;

  return jsonb_build_object(
    'eventsDeleted', events_deleted,
    'batchesDeleted', batches_deleted,
    'sessionsDeleted', sessions_deleted
  );
end;
$$;

revoke all on function public.purge_expired_product_usage_data() from public;
grant execute on function public.purge_expired_product_usage_data() to service_role;

create or replace function public.get_product_analytics_snapshot(
  period_days_value integer default 30,
  target_product_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff_value timestamptz;
  result_value jsonb;
begin
  if not public.is_platform_staff() then
    raise exception 'Platform staff access is required';
  end if;

  if period_days_value < 1 or period_days_value > 365 then
    raise exception 'Analytics period must be between 1 and 365 days';
  end if;

  cutoff_value := now() - make_interval(days => period_days_value);

  with selected_products as (
    select product.id, product.key, product.name
    from public.products product
    where product.archived_at is null
      and (target_product_id is null or product.id = target_product_id)
  ),
  scoped_sessions as (
    select session.*
    from public.product_usage_sessions session
    join selected_products product on product.id = session.product_id
    where session.started_at >= cutoff_value
  ),
  scoped_events as (
    select event.*
    from public.product_usage_events event
    join selected_products product on product.id = event.product_id
    where event.occurred_at >= cutoff_value
  ),
  live_sessions as (
    select session.*
    from public.product_usage_sessions session
    join selected_products product on product.id = session.product_id
    where session.ended_at is null
      and session.last_seen_at >= now() - interval '90 seconds'
  ),
  products_payload as (
    select
      product.id,
      product.key,
      product.name,
      (select count(*) from live_sessions live where live.product_id = product.id)::integer as online_now,
      (select count(*) from live_sessions live where live.product_id = product.id and live.last_activity_at >= now() - interval '60 seconds')::integer as active_now,
      (select count(distinct event.user_key) from scoped_events event where event.product_id = product.id and event.occurred_on = current_date and event.user_key is not null)::integer as dau,
      (select count(*) from scoped_sessions session where session.product_id = product.id)::integer as sessions,
      (select count(distinct event.user_key) from scoped_events event where event.product_id = product.id and event.user_key is not null)::integer as unique_users,
      coalesce((select sum(session.active_seconds) from scoped_sessions session where session.product_id = product.id), 0)::bigint as active_seconds,
      (select count(*) from scoped_events event where event.product_id = product.id)::bigint as event_count,
      (select count(*) from scoped_events event where event.product_id = product.id and (event.category = 'error' or event.outcome = 'failure'))::bigint as error_count,
      (select max(event.occurred_at) from public.product_usage_events event where event.product_id = product.id) as last_event_at
    from selected_products product
  ),
  features_payload as (
    select
      event.product_id,
      host.name as product_name,
      event.module_owner_product_id,
      owner.name as module_owner_product_name,
      coalesce(event.module_key, 'product') as module_key,
      coalesce(max(event.module_name), coalesce(event.module_key, 'Product')) as module_name,
      coalesce(event.feature_key, event.event_name) as feature_key,
      count(*)::bigint as event_count,
      count(distinct event.user_key) filter (where event.user_key is not null)::integer as unique_users,
      count(*) filter (where event.outcome = 'success')::bigint as success_count,
      count(*) filter (where event.outcome = 'failure' or event.category = 'error')::bigint as failure_count,
      max(event.occurred_at) as last_used_at
    from scoped_events event
    join public.products host on host.id = event.product_id
    left join public.products owner on owner.id = event.module_owner_product_id
    where event.category in ('feature', 'business', 'navigation')
      and event.event_name not in ('session_started', 'session_heartbeat', 'session_ended')
    group by
      event.product_id,
      host.name,
      event.module_owner_product_id,
      owner.name,
      coalesce(event.module_key, 'product'),
      coalesce(event.feature_key, event.event_name)
  ),
  tenant_payload as (
    select
      event.organization_id,
      coalesce(organization.name, max(nullif(event.organization_key, '')), 'Без компании') as organization_name,
      count(distinct event.user_key) filter (where event.user_key is not null)::integer as unique_users,
      count(distinct event.session_id) filter (where event.session_id is not null)::integer as sessions,
      coalesce(sum(event.active_seconds_delta), 0)::bigint as active_seconds,
      count(*)::bigint as event_count,
      count(*) filter (where event.category = 'error' or event.outcome = 'failure')::bigint as error_count,
      max(event.occurred_at) as last_seen_at
    from scoped_events event
    left join public.organizations organization on organization.id = event.organization_id
    group by event.organization_id, organization.name
  ),
  series_days as (
    select generate_series(
      current_date - (period_days_value - 1),
      current_date,
      interval '1 day'
    )::date as day
  )
  select jsonb_build_object(
    'generatedAt', now(),
    'periodDays', period_days_value,
    'targetProductId', target_product_id,
    'metrics', jsonb_build_object(
      'onlineNow', (select count(*) from live_sessions),
      'activeNow', (select count(*) from live_sessions where last_activity_at >= now() - interval '60 seconds'),
      'dau', (select count(distinct user_key) from scoped_events where occurred_on = current_date and user_key is not null),
      'uniqueUsers', (select count(distinct user_key) from scoped_events where user_key is not null),
      'sessions', (select count(*) from scoped_sessions),
      'activeSeconds', coalesce((select sum(active_seconds) from scoped_sessions), 0),
      'events', (select count(*) from scoped_events),
      'errors', (select count(*) from scoped_events where category = 'error' or outcome = 'failure'),
      'errorFreePercent', case
        when (select count(*) from scoped_sessions) = 0 then 100
        else round(
          100 * (
            1 - (
              select count(distinct session_id)::numeric
              from scoped_events
              where session_id is not null
                and (category = 'error' or outcome = 'failure')
            ) / greatest((select count(*)::numeric from scoped_sessions), 1)
          ),
          2
        )
      end
    ),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', item.id,
        'key', item.key,
        'name', item.name,
        'onlineNow', item.online_now,
        'activeNow', item.active_now,
        'dau', item.dau,
        'sessions', item.sessions,
        'uniqueUsers', item.unique_users,
        'activeSeconds', item.active_seconds,
        'eventCount', item.event_count,
        'errorCount', item.error_count,
        'lastEventAt', item.last_event_at
      ) order by item.online_now desc, item.dau desc, item.name)
      from products_payload item
    ), '[]'::jsonb),
    'liveSessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', live.id,
        'userKey', live.user_key,
        'userLabel', coalesce(live.user_label, live.user_key, 'Анонимный пользователь'),
        'userRole', live.user_role,
        'organizationId', live.organization_id,
        'organizationName', coalesce(organization.name, live.organization_key, 'Без компании'),
        'branchName', coalesce(branch.name, live.branch_key, 'Все филиалы'),
        'productId', live.product_id,
        'productName', product.name,
        'moduleOwnerProductName', owner.name,
        'moduleKey', live.current_module_key,
        'moduleName', live.current_module_name,
        'route', live.current_route,
        'status', case
          when live.last_activity_at >= now() - interval '60 seconds' and live.is_tab_visible then 'active'
          else 'idle'
        end,
        'startedAt', live.started_at,
        'lastSeenAt', live.last_seen_at,
        'activeSeconds', live.active_seconds,
        'idleSeconds', live.idle_seconds,
        'appVersion', live.app_version,
        'deviceType', live.device_type
      ) order by live.last_seen_at desc)
      from (
        select * from live_sessions order by last_seen_at desc limit 250
      ) live
      join public.products product on product.id = live.product_id
      left join public.products owner on owner.id = live.module_owner_product_id
      left join public.organizations organization on organization.id = live.organization_id
      left join public.branches branch on branch.id = live.branch_id
    ), '[]'::jsonb),
    'features', coalesce((
      select jsonb_agg(jsonb_build_object(
        'productId', item.product_id,
        'productName', item.product_name,
        'moduleOwnerProductId', item.module_owner_product_id,
        'moduleOwnerProductName', item.module_owner_product_name,
        'moduleKey', item.module_key,
        'moduleName', item.module_name,
        'featureKey', item.feature_key,
        'eventCount', item.event_count,
        'uniqueUsers', item.unique_users,
        'successCount', item.success_count,
        'failureCount', item.failure_count,
        'successRate', case
          when item.success_count + item.failure_count = 0 then 100
          else round(100 * item.success_count::numeric / (item.success_count + item.failure_count), 2)
        end,
        'lastUsedAt', item.last_used_at
      ) order by item.event_count desc, item.feature_key)
      from (select * from features_payload order by event_count desc limit 200) item
    ), '[]'::jsonb),
    'tenants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'organizationId', item.organization_id,
        'organizationName', item.organization_name,
        'uniqueUsers', item.unique_users,
        'sessions', item.sessions,
        'activeSeconds', item.active_seconds,
        'eventCount', item.event_count,
        'errorCount', item.error_count,
        'lastSeenAt', item.last_seen_at,
        'risk', case
          when item.last_seen_at < now() - interval '14 days' then 'high'
          when item.last_seen_at < now() - interval '7 days' then 'medium'
          when item.event_count > 0 and item.error_count::numeric / item.event_count >= 0.10 then 'medium'
          else 'low'
        end
      ) order by item.active_seconds desc, item.organization_name)
      from tenant_payload item
    ), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', source.id,
        'productId', source.product_id,
        'productName', product.name,
        'sourceKey', source.source_key,
        'name', source.name,
        'sourceType', source.source_type,
        'environment', source.environment,
        'allowedOrigins', source.allowed_origins,
        'status', source.status,
        'sampleRate', source.sample_rate,
        'heartbeatIntervalSeconds', source.heartbeat_interval_seconds,
        'idleTimeoutSeconds', source.idle_timeout_seconds,
        'sessionTimeoutSeconds', source.session_timeout_seconds,
        'retentionDays', source.retention_days,
        'lastEventAt', source.last_event_at,
        'lastError', source.last_error,
        'createdAt', source.created_at
      ) order by product.name, source.name)
      from public.telemetry_sources source
      join selected_products product on product.id = source.product_id
    ), '[]'::jsonb),
    'series', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', day.day,
        'users', (select count(distinct event.user_key) from scoped_events event where event.occurred_on = day.day and event.user_key is not null),
        'sessions', (select count(*) from scoped_sessions session where (session.started_at at time zone 'UTC')::date = day.day),
        'events', (select count(*) from scoped_events event where event.occurred_on = day.day),
        'errors', (select count(*) from scoped_events event where event.occurred_on = day.day and (event.category = 'error' or event.outcome = 'failure')),
        'activeSeconds', coalesce((select sum(event.active_seconds_delta) from scoped_events event where event.occurred_on = day.day), 0)
      ) order by day.day)
      from series_days day
    ), '[]'::jsonb),
    'catalog', coalesce((
      select jsonb_agg(jsonb_build_object('id', product.id, 'key', product.key, 'name', product.name) order by product.name)
      from public.products product
      where product.archived_at is null
        and product.status <> 'disabled'
    ), '[]'::jsonb)
  ) into result_value;

  return result_value;
end;
$$;

revoke all on function public.get_product_analytics_snapshot(integer, uuid) from public;
grant execute on function public.get_product_analytics_snapshot(integer, uuid) to authenticated;

create or replace function public.prevent_product_usage_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' and current_user in ('service_role', 'postgres') then
    return old;
  end if;
  raise exception 'Product usage event records are immutable';
end;
$$;

revoke all on function public.prevent_product_usage_mutation() from public;

create trigger product_usage_events_immutable
before update or delete on public.product_usage_events
for each row execute function public.prevent_product_usage_mutation();

create trigger telemetry_ingestion_batches_immutable
before update or delete on public.telemetry_ingestion_batches
for each row execute function public.prevent_product_usage_mutation();

create view public.analytics_live_sessions
with (security_invoker = true)
as
select
  session.id,
  session.user_key,
  session.user_label,
  session.user_role,
  session.organization_id,
  coalesce(organization.name, session.organization_key, 'Без компании') as organization_name,
  session.branch_id,
  coalesce(branch.name, session.branch_key, 'Все филиалы') as branch_name,
  session.product_id,
  product.key as product_key,
  product.name as product_name,
  session.module_owner_product_id,
  owner.name as module_owner_product_name,
  session.current_module_key,
  session.current_module_name,
  session.current_route,
  case
    when session.last_activity_at >= now() - interval '60 seconds' and session.is_tab_visible then 'active'
    else 'idle'
  end as derived_status,
  session.started_at,
  session.last_seen_at,
  session.last_activity_at,
  session.active_seconds,
  session.idle_seconds,
  session.app_version,
  session.device_type
from public.product_usage_sessions session
join public.products product on product.id = session.product_id
left join public.products owner on owner.id = session.module_owner_product_id
left join public.organizations organization on organization.id = session.organization_id
left join public.branches branch on branch.id = session.branch_id
where session.ended_at is null
  and session.last_seen_at >= now() - interval '90 seconds';

create view public.analytics_telemetry_sources
with (security_invoker = true)
as
select
  source.id,
  source.product_id,
  product.key as product_key,
  product.name as product_name,
  source.source_key,
  source.name,
  source.source_type,
  source.environment,
  source.allowed_origins,
  source.status,
  source.sample_rate,
  source.heartbeat_interval_seconds,
  source.idle_timeout_seconds,
  source.session_timeout_seconds,
  source.retention_days,
  source.last_event_at,
  source.last_error,
  source.config,
  source.created_at,
  source.updated_at
from public.telemetry_sources source
join public.products product on product.id = source.product_id;

alter table public.telemetry_sources enable row level security;
alter table public.telemetry_event_definitions enable row level security;
alter table public.product_usage_sessions enable row level security;
alter table public.product_usage_events enable row level security;
alter table public.product_usage_daily_rollups enable row level security;
alter table public.telemetry_ingestion_batches enable row level security;

create policy telemetry_sources_staff_select
on public.telemetry_sources for select
to authenticated using (public.is_platform_staff());

create policy telemetry_event_definitions_staff_select
on public.telemetry_event_definitions for select
to authenticated using (public.is_platform_staff());

create policy product_usage_sessions_staff_select
on public.product_usage_sessions for select
to authenticated using (public.is_platform_staff());

create policy product_usage_events_staff_select
on public.product_usage_events for select
to authenticated using (public.is_platform_staff());

create policy product_usage_rollups_staff_select
on public.product_usage_daily_rollups for select
to authenticated using (public.is_platform_staff());

create policy telemetry_batches_staff_select
on public.telemetry_ingestion_batches for select
to authenticated using (public.is_platform_staff());

revoke all on public.telemetry_sources from anon, authenticated;
revoke all on public.telemetry_event_definitions from anon, authenticated;
revoke all on public.product_usage_sessions from anon, authenticated;
revoke all on public.product_usage_events from anon, authenticated;
revoke all on public.product_usage_daily_rollups from anon, authenticated;
revoke all on public.telemetry_ingestion_batches from anon, authenticated;

-- The write-key hash is deliberately excluded from authenticated column grants.
grant select (
  id,
  product_id,
  source_key,
  name,
  source_type,
  environment,
  allowed_origins,
  status,
  sample_rate,
  heartbeat_interval_seconds,
  idle_timeout_seconds,
  session_timeout_seconds,
  retention_days,
  last_event_at,
  last_error,
  config,
  created_by,
  created_at,
  updated_at
) on public.telemetry_sources to authenticated;
grant select on public.telemetry_event_definitions to authenticated;
grant select on public.product_usage_sessions to authenticated;
grant select on public.product_usage_events to authenticated;
grant select on public.product_usage_daily_rollups to authenticated;
grant select on public.telemetry_ingestion_batches to authenticated;
grant select on public.analytics_live_sessions to authenticated;
grant select on public.analytics_telemetry_sources to authenticated;

grant all on public.telemetry_sources to service_role;
grant all on public.telemetry_event_definitions to service_role;
grant all on public.product_usage_sessions to service_role;
grant all on public.product_usage_events to service_role;
grant all on public.product_usage_daily_rollups to service_role;
grant all on public.telemetry_ingestion_batches to service_role;
grant usage, select on sequence public.product_usage_daily_rollups_id_seq to service_role;

comment on table public.telemetry_sources is
  'Per-product browser or server telemetry credentials. Only a SHA-256 write-key hash is stored.';
comment on table public.product_usage_sessions is
  'Live presence and measured active/idle time for IMDS product sessions.';
comment on table public.product_usage_events is
  'Sanitized, append-only product events. Medical and arbitrary business payloads are prohibited.';
comment on table public.product_usage_daily_rollups is
  'Daily aggregate usage metrics used for long-range reporting and billing calculations.';
comment on table public.telemetry_ingestion_batches is
  'Request-level ingestion audit without raw request bodies or network addresses.';
comment on function public.get_product_analytics_snapshot(integer, uuid) is
  'Returns an authorization-checked aggregate analytics snapshot for IMDS platform staff.';
