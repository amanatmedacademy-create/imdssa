-- IMDS Observability & Incident Management powered by an external Checkmate service.
-- Checkmate remains a separately deployed AGPL service. This migration stores only
-- control-plane configuration, service mappings, current health, incidents and sync history.

create type public.observability_connection_status as enum (
  'draft',
  'active',
  'degraded',
  'disabled'
);

create type public.observability_service_kind as enum (
  'frontend',
  'api',
  'worker',
  'database',
  'storage',
  'queue',
  'integration',
  'infrastructure',
  'other'
);

create type public.observability_service_status as enum (
  'unknown',
  'initializing',
  'up',
  'degraded',
  'down',
  'paused',
  'maintenance'
);

create type public.observability_incident_status as enum (
  'open',
  'resolved',
  'suppressed'
);

create type public.observability_incident_impact as enum (
  'none',
  'minor',
  'major',
  'critical'
);

create type public.observability_sync_status as enum (
  'queued',
  'running',
  'succeeded',
  'partial',
  'failed',
  'cancelled'
);

create type public.observability_sync_type as enum (
  'connection_test',
  'monitors',
  'incidents',
  'maintenance',
  'status_pages',
  'full'
);

create type public.observability_maintenance_status as enum (
  'scheduled',
  'active',
  'completed',
  'cancelled'
);

create table public.observability_connections (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null default 'checkmate',
  name text not null,
  environment public.product_endpoint_environment not null default 'production',
  api_base_url text not null,
  secret_reference text not null,
  status public.observability_connection_status not null default 'draft',
  timeout_ms integer not null default 15000 check (timeout_ms between 1000 and 120000),
  verify_tls boolean not null default true,
  last_tested_at timestamptz,
  last_sync_at timestamptz,
  last_latency_ms integer check (last_latency_ms is null or last_latency_ms >= 0),
  last_error text,
  config jsonb not null default '{}'::jsonb,
  created_by uuid references public.platform_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_key, environment),
  check (provider_key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  check (api_base_url ~ '^https?://'),
  check (secret_reference ~ '^(env|vault)://[A-Za-z0-9_./-]+$'),
  check (environment <> 'production' or api_base_url ~ '^https://')
);

create table public.observability_services (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  connection_id uuid references public.observability_connections(id) on delete set null,
  environment public.product_endpoint_environment not null default 'production',
  service_key text not null,
  name text not null,
  description text,
  kind public.observability_service_kind not null default 'api',
  owner_team text,
  criticality smallint not null default 3 check (criticality between 1 and 5),
  target_url text,
  expected_http_status integer check (expected_http_status is null or expected_http_status between 100 and 599),
  slo_target_percent numeric(6,3) not null default 99.900 check (slo_target_percent between 0 and 100),
  monitor_type text not null default 'http',
  monitor_interval_ms integer not null default 60000 check (monitor_interval_ms between 10000 and 86400000),
  desired_monitor_state text not null default 'active' check (desired_monitor_state in ('active', 'paused', 'disabled')),
  monitor_config jsonb not null default '{}'::jsonb,
  checkmate_monitor_id text,
  status public.observability_service_status not null default 'unknown',
  current_uptime_percent numeric(7,4) check (current_uptime_percent is null or current_uptime_percent between 0 and 100),
  current_latency_ms integer check (current_latency_ms is null or current_latency_ms >= 0),
  ssl_expires_at timestamptz,
  last_check_at timestamptz,
  status_changed_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  visible_on_status_page boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  archived_at timestamptz,
  created_by uuid references public.platform_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, environment, service_key),
  unique (connection_id, checkmate_monitor_id),
  check (service_key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  check (monitor_type in ('http', 'port', 'ping', 'hardware', 'docker', 'pagespeed', 'grpc', 'dns', 'game')),
  check (target_url is null or length(target_url) between 1 and 2048),
  check (checkmate_monitor_id is null or length(checkmate_monitor_id) between 1 and 255)
);

create table public.observability_incidents (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.observability_connections(id) on delete cascade,
  service_id uuid references public.observability_services(id) on delete set null,
  external_incident_id text not null,
  external_monitor_id text,
  status public.observability_incident_status not null default 'open',
  impact public.observability_incident_impact not null default 'major',
  title text not null,
  message text,
  http_status integer check (http_status is null or http_status between 100 and 599),
  started_at timestamptz not null,
  resolved_at timestamptz,
  resolution_type text check (resolution_type is null or resolution_type in ('automatic', 'manual')),
  resolved_by text,
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.platform_users(id),
  last_synced_at timestamptz not null default now(),
  correlation_id uuid not null default gen_random_uuid(),
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, external_incident_id),
  check (char_length(btrim(title)) > 0),
  check (resolved_at is null or resolved_at >= started_at)
);

create table public.observability_maintenance_windows (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.observability_connections(id) on delete cascade,
  external_window_id text,
  name text not null,
  description text,
  status public.observability_maintenance_status not null default 'scheduled',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  repeat_seconds integer not null default 0 check (repeat_seconds >= 0),
  expires_at timestamptz,
  active boolean not null default true,
  last_synced_at timestamptz,
  raw_payload jsonb not null default '{}'::jsonb,
  created_by uuid references public.platform_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, external_window_id),
  check (ends_at > starts_at),
  check (expires_at is null or expires_at >= ends_at)
);

create table public.observability_maintenance_services (
  maintenance_window_id uuid not null references public.observability_maintenance_windows(id) on delete cascade,
  service_id uuid not null references public.observability_services(id) on delete cascade,
  primary key (maintenance_window_id, service_id)
);

create table public.observability_status_pages (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.observability_connections(id) on delete cascade,
  external_page_id text,
  name text not null,
  slug text not null,
  custom_domain text,
  public_url text,
  theme text,
  is_published boolean not null default false,
  last_synced_at timestamptz,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, external_page_id),
  unique (connection_id, slug),
  check (slug ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  check (public_url is null or public_url ~ '^https?://')
);

create table public.observability_status_page_services (
  status_page_id uuid not null references public.observability_status_pages(id) on delete cascade,
  service_id uuid not null references public.observability_services(id) on delete cascade,
  display_order integer not null default 0,
  primary key (status_page_id, service_id)
);

create table public.observability_sync_runs (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.observability_connections(id) on delete cascade,
  sync_type public.observability_sync_type not null,
  status public.observability_sync_status not null default 'queued',
  requested_by uuid references public.platform_users(id),
  worker_id text,
  correlation_id uuid not null default gen_random_uuid(),
  started_at timestamptz,
  finished_at timestamptz,
  records_received integer not null default 0 check (records_received >= 0),
  records_written integer not null default 0 check (records_written >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  error text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (finished_at is null or started_at is not null),
  check (finished_at is null or finished_at >= started_at)
);

create table public.observability_events (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references public.observability_connections(id) on delete cascade,
  service_id uuid references public.observability_services(id) on delete set null,
  incident_id uuid references public.observability_incidents(id) on delete set null,
  event_type text not null,
  severity text not null default 'info' check (severity in ('debug', 'info', 'warning', 'error', 'critical')),
  message text not null,
  payload jsonb not null default '{}'::jsonb,
  correlation_id uuid,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (event_type ~ '^[a-z0-9]+([._-][a-z0-9]+)*$')
);

create index observability_connections_status_idx
  on public.observability_connections(status, environment);
create index observability_services_product_environment_idx
  on public.observability_services(product_id, environment, status)
  where archived_at is null;
create index observability_services_checkmate_idx
  on public.observability_services(connection_id, checkmate_monitor_id)
  where checkmate_monitor_id is not null;
create index observability_incidents_open_idx
  on public.observability_incidents(status, impact, started_at desc)
  where status = 'open';
create index observability_incidents_service_time_idx
  on public.observability_incidents(service_id, started_at desc);
create index observability_maintenance_time_idx
  on public.observability_maintenance_windows(starts_at, ends_at, status);
create index observability_sync_runs_connection_time_idx
  on public.observability_sync_runs(connection_id, created_at desc);
create index observability_events_time_idx
  on public.observability_events(occurred_at desc);

create trigger observability_connections_set_updated_at
before update on public.observability_connections
for each row execute function public.set_updated_at();

create trigger observability_services_set_updated_at
before update on public.observability_services
for each row execute function public.set_updated_at();

create trigger observability_incidents_set_updated_at
before update on public.observability_incidents
for each row execute function public.set_updated_at();

create trigger observability_maintenance_windows_set_updated_at
before update on public.observability_maintenance_windows
for each row execute function public.set_updated_at();

create trigger observability_status_pages_set_updated_at
before update on public.observability_status_pages
for each row execute function public.set_updated_at();

create or replace function public.can_manage_observability()
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

revoke all on function public.can_manage_observability() from public;
grant execute on function public.can_manage_observability() to authenticated;

create or replace function public.configure_observability_connection(
  target_connection_id uuid,
  connection_name text,
  environment_value public.product_endpoint_environment,
  api_base_url_value text,
  secret_reference_value text,
  status_value public.observability_connection_status,
  timeout_ms_value integer default 15000,
  verify_tls_value boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  connection_id_value uuid;
  before_record jsonb;
  normalized_url text;
  normalized_reference text;
begin
  if not public.can_manage_observability() then
    raise exception 'Insufficient permission to configure observability';
  end if;

  connection_name := nullif(btrim(connection_name), '');
  normalized_url := nullif(rtrim(btrim(api_base_url_value), '/'), '');
  normalized_reference := nullif(btrim(secret_reference_value), '');

  if connection_name is null then raise exception 'Connection name is required'; end if;
  if normalized_url is null or normalized_url !~ '^https?://' then raise exception 'API base URL is invalid'; end if;
  if environment_value = 'production' and normalized_url !~ '^https://' then
    raise exception 'Production Checkmate URL must use HTTPS';
  end if;
  if normalized_reference is null or normalized_reference !~ '^(env|vault)://[A-Za-z0-9_./-]+$' then
    raise exception 'Secret reference must use env:// or vault://';
  end if;
  if timeout_ms_value < 1000 or timeout_ms_value > 120000 then
    raise exception 'Timeout is outside the allowed range';
  end if;

  if target_connection_id is null then
    insert into public.observability_connections (
      provider_key,
      name,
      environment,
      api_base_url,
      secret_reference,
      status,
      timeout_ms,
      verify_tls,
      created_by
    ) values (
      'checkmate',
      connection_name,
      environment_value,
      normalized_url,
      normalized_reference,
      status_value,
      timeout_ms_value,
      verify_tls_value,
      auth.uid()
    ) returning id into connection_id_value;
  else
    select to_jsonb(connection) into before_record
    from public.observability_connections connection
    where connection.id = target_connection_id;

    if before_record is null then raise exception 'Observability connection not found'; end if;

    update public.observability_connections
    set name = connection_name,
        environment = environment_value,
        api_base_url = normalized_url,
        secret_reference = normalized_reference,
        status = status_value,
        timeout_ms = timeout_ms_value,
        verify_tls = verify_tls_value,
        last_error = case when status_value = 'disabled' then last_error else null end
    where id = target_connection_id
    returning id into connection_id_value;
  end if;

  perform public.write_audit_event(
    case when target_connection_id is null then 'observability.connection.created' else 'observability.connection.updated' end,
    'observability_connection',
    connection_id_value::text,
    null,
    'Checkmate connection configuration',
    before_record - 'secret_reference',
    (
      select to_jsonb(connection) - 'secret_reference' || jsonb_build_object('hasSecretReference', true)
      from public.observability_connections connection
      where connection.id = connection_id_value
    )
  );

  return connection_id_value;
end;
$$;

revoke all on function public.configure_observability_connection(uuid, text, public.product_endpoint_environment, text, text, public.observability_connection_status, integer, boolean) from public;
grant execute on function public.configure_observability_connection(uuid, text, public.product_endpoint_environment, text, text, public.observability_connection_status, integer, boolean) to authenticated;

create or replace function public.upsert_observability_service(
  target_service_id uuid,
  product_id_value uuid,
  connection_id_value uuid,
  environment_value public.product_endpoint_environment,
  service_key_value text,
  name_value text,
  description_value text,
  kind_value public.observability_service_kind,
  owner_team_value text,
  criticality_value smallint,
  target_url_value text,
  expected_http_status_value integer,
  slo_target_percent_value numeric,
  monitor_type_value text,
  monitor_interval_ms_value integer,
  visible_on_status_page_value boolean,
  monitor_config_value jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  service_id_value uuid;
  before_record jsonb;
  normalized_key text;
  normalized_name text;
  normalized_target text;
begin
  if not public.can_manage_observability() then
    raise exception 'Insufficient permission to manage observability services';
  end if;

  if not exists (
    select 1 from public.products
    where id = product_id_value
      and archived_at is null
      and status <> 'disabled'
  ) then raise exception 'Product is unavailable'; end if;

  if connection_id_value is not null and not exists (
    select 1 from public.observability_connections
    where id = connection_id_value and status <> 'disabled'
  ) then raise exception 'Observability connection is unavailable'; end if;

  normalized_key := lower(nullif(btrim(service_key_value), ''));
  normalized_name := nullif(btrim(name_value), '');
  normalized_target := nullif(btrim(target_url_value), '');

  if normalized_key is null or normalized_key !~ '^[a-z0-9]+([._-][a-z0-9]+)*$' then
    raise exception 'Service key is invalid';
  end if;
  if normalized_name is null then raise exception 'Service name is required'; end if;
  if monitor_type_value not in ('http', 'port', 'ping', 'hardware', 'docker', 'pagespeed', 'grpc', 'dns', 'game') then
    raise exception 'Unsupported Checkmate monitor type';
  end if;
  if monitor_type_value in ('http', 'pagespeed') and normalized_target is null then
    raise exception 'HTTP and PageSpeed monitors require a target URL';
  end if;
  if criticality_value < 1 or criticality_value > 5 then raise exception 'Criticality must be between 1 and 5'; end if;
  if slo_target_percent_value < 0 or slo_target_percent_value > 100 then raise exception 'SLO target is invalid'; end if;
  if monitor_interval_ms_value < 10000 or monitor_interval_ms_value > 86400000 then raise exception 'Monitor interval is invalid'; end if;

  if target_service_id is null then
    insert into public.observability_services (
      product_id,
      connection_id,
      environment,
      service_key,
      name,
      description,
      kind,
      owner_team,
      criticality,
      target_url,
      expected_http_status,
      slo_target_percent,
      monitor_type,
      monitor_interval_ms,
      visible_on_status_page,
      monitor_config,
      created_by
    ) values (
      product_id_value,
      connection_id_value,
      environment_value,
      normalized_key,
      normalized_name,
      nullif(btrim(description_value), ''),
      kind_value,
      nullif(btrim(owner_team_value), ''),
      criticality_value,
      normalized_target,
      expected_http_status_value,
      slo_target_percent_value,
      monitor_type_value,
      monitor_interval_ms_value,
      visible_on_status_page_value,
      coalesce(monitor_config_value, '{}'::jsonb),
      auth.uid()
    ) returning id into service_id_value;
  else
    select to_jsonb(service) into before_record
    from public.observability_services service
    where service.id = target_service_id;

    if before_record is null then raise exception 'Observability service not found'; end if;

    update public.observability_services
    set product_id = product_id_value,
        connection_id = connection_id_value,
        environment = environment_value,
        service_key = normalized_key,
        name = normalized_name,
        description = nullif(btrim(description_value), ''),
        kind = kind_value,
        owner_team = nullif(btrim(owner_team_value), ''),
        criticality = criticality_value,
        target_url = normalized_target,
        expected_http_status = expected_http_status_value,
        slo_target_percent = slo_target_percent_value,
        monitor_type = monitor_type_value,
        monitor_interval_ms = monitor_interval_ms_value,
        visible_on_status_page = visible_on_status_page_value,
        monitor_config = coalesce(monitor_config_value, '{}'::jsonb),
        archived_at = null
    where id = target_service_id
    returning id into service_id_value;
  end if;

  perform public.write_audit_event(
    case when target_service_id is null then 'observability.service.created' else 'observability.service.updated' end,
    'observability_service',
    service_id_value::text,
    null,
    'Service Registry configuration',
    before_record,
    (select to_jsonb(service) from public.observability_services service where service.id = service_id_value)
  );

  return service_id_value;
end;
$$;

revoke all on function public.upsert_observability_service(uuid, uuid, uuid, public.product_endpoint_environment, text, text, text, public.observability_service_kind, text, smallint, text, integer, numeric, text, integer, boolean, jsonb) from public;
grant execute on function public.upsert_observability_service(uuid, uuid, uuid, public.product_endpoint_environment, text, text, text, public.observability_service_kind, text, smallint, text, integer, numeric, text, integer, boolean, jsonb) to authenticated;

create or replace function public.archive_observability_service(
  target_service_id uuid,
  reason_value text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  before_record jsonb;
begin
  if not public.can_manage_observability() then
    raise exception 'Insufficient permission to archive observability services';
  end if;
  if char_length(btrim(reason_value)) < 5 then raise exception 'Archive reason must contain at least 5 characters'; end if;

  select to_jsonb(service) into before_record
  from public.observability_services service
  where service.id = target_service_id and service.archived_at is null;

  if before_record is null then raise exception 'Active observability service not found'; end if;

  update public.observability_services
  set archived_at = now(),
      desired_monitor_state = 'disabled',
      status = 'paused'
  where id = target_service_id;

  perform public.write_audit_event(
    'observability.service.archived',
    'observability_service',
    target_service_id::text,
    null,
    btrim(reason_value),
    before_record,
    (select to_jsonb(service) from public.observability_services service where service.id = target_service_id)
  );
end;
$$;

revoke all on function public.archive_observability_service(uuid, text) from public;
grant execute on function public.archive_observability_service(uuid, text) to authenticated;

create or replace function public.acknowledge_observability_incident(
  target_incident_id uuid,
  note_value text
)
returns void
language plpgsql
security definer
set search_path = public
as $$;
declare
  incident_record public.observability_incidents%rowtype;
begin
  if not public.has_global_role(array[
    'platform_owner'::public.global_role,
    'super_admin'::public.global_role,
    'technical_admin'::public.global_role,
    'support_admin'::public.global_role
  ]) then raise exception 'Insufficient permission to acknowledge incidents'; end if;

  if char_length(btrim(note_value)) < 3 then raise exception 'Acknowledgement note is required'; end if;

  select * into incident_record
  from public.observability_incidents
  where id = target_incident_id
  for update;

  if not found then raise exception 'Incident not found'; end if;

  update public.observability_incidents
  set acknowledged_at = coalesce(acknowledged_at, now()),
      acknowledged_by = coalesce(acknowledged_by, auth.uid()),
      raw_payload = raw_payload || jsonb_build_object('imdsAcknowledgementNote', btrim(note_value))
  where id = target_incident_id;

  perform public.write_audit_event(
    'observability.incident.acknowledged',
    'observability_incident',
    target_incident_id::text,
    null,
    btrim(note_value),
    null,
    jsonb_build_object('acknowledgedAt', now())
  );
end;
$$;

revoke all on function public.acknowledge_observability_incident(uuid, text) from public;
grant execute on function public.acknowledge_observability_incident(uuid, text) to authenticated;

create or replace function public.prevent_observability_event_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Observability events are append-only';
end;
$$;

revoke all on function public.prevent_observability_event_mutation() from public;

create trigger observability_events_immutable
before update or delete on public.observability_events
for each row execute function public.prevent_observability_event_mutation();

alter table public.observability_connections enable row level security;
alter table public.observability_services enable row level security;
alter table public.observability_incidents enable row level security;
alter table public.observability_maintenance_windows enable row level security;
alter table public.observability_maintenance_services enable row level security;
alter table public.observability_status_pages enable row level security;
alter table public.observability_status_page_services enable row level security;
alter table public.observability_sync_runs enable row level security;
alter table public.observability_events enable row level security;

create policy observability_connections_staff_select
on public.observability_connections for select
to authenticated using (public.is_platform_staff());

create policy observability_services_staff_select
on public.observability_services for select
to authenticated using (public.is_platform_staff());

create policy observability_incidents_staff_select
on public.observability_incidents for select
to authenticated using (public.is_platform_staff());

create policy observability_maintenance_staff_select
on public.observability_maintenance_windows for select
to authenticated using (public.is_platform_staff());

create policy observability_maintenance_services_staff_select
on public.observability_maintenance_services for select
to authenticated using (public.is_platform_staff());

create policy observability_status_pages_staff_select
on public.observability_status_pages for select
to authenticated using (public.is_platform_staff());

create policy observability_status_page_services_staff_select
on public.observability_status_page_services for select
to authenticated using (public.is_platform_staff());

create policy observability_sync_runs_staff_select
on public.observability_sync_runs for select
to authenticated using (public.is_platform_staff());

create policy observability_events_staff_select
on public.observability_events for select
to authenticated using (public.is_platform_staff());

revoke insert, update, delete on public.observability_connections from authenticated;
revoke insert, update, delete on public.observability_services from authenticated;
revoke insert, update, delete on public.observability_incidents from authenticated;
revoke insert, update, delete on public.observability_maintenance_windows from authenticated;
revoke insert, update, delete on public.observability_maintenance_services from authenticated;
revoke insert, update, delete on public.observability_status_pages from authenticated;
revoke insert, update, delete on public.observability_status_page_services from authenticated;
revoke insert, update, delete on public.observability_sync_runs from authenticated;
revoke insert, update, delete on public.observability_events from authenticated;

grant select on public.observability_connections to authenticated;
grant select on public.observability_services to authenticated;
grant select on public.observability_incidents to authenticated;
grant select on public.observability_maintenance_windows to authenticated;
grant select on public.observability_maintenance_services to authenticated;
grant select on public.observability_status_pages to authenticated;
grant select on public.observability_status_page_services to authenticated;
grant select on public.observability_sync_runs to authenticated;
grant select on public.observability_events to authenticated;

grant all on public.observability_connections to service_role;
grant all on public.observability_services to service_role;
grant all on public.observability_incidents to service_role;
grant all on public.observability_maintenance_windows to service_role;
grant all on public.observability_maintenance_services to service_role;
grant all on public.observability_status_pages to service_role;
grant all on public.observability_status_page_services to service_role;
grant all on public.observability_sync_runs to service_role;
grant all on public.observability_events to service_role;

comment on table public.observability_connections is
  'Connection metadata for separately deployed monitoring engines. Tokens are external secret references, never plaintext.';
comment on table public.observability_services is
  'IMDS service catalogue mapped to Checkmate monitors by environment.';
comment on table public.observability_incidents is
  'Normalized incident projection synchronized from Checkmate. Operational history remains in Checkmate.';
comment on table public.observability_sync_runs is
  'Durable execution history for Checkmate adapter test and synchronization runs.';
comment on table public.observability_events is
  'Append-only normalized observability event stream for the IMDS control plane.';
